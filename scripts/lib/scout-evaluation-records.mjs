// Offline records only. Model execution, artifact IO and fixed-oracle verification
// belong to the existing GSD runner and the CLI, never to this aggregation module.
import { createHash } from 'node:crypto';

export const EVALUATION_SCHEMA_VERSION = 'gsd.scout-eval/v1';
export const EVALUATION_LIMITS = Object.freeze({ trials: 1000, records: 10000, usageRows: 100 });
const VARIANTS = ['baseline', 'candidate'];
const OUTCOMES = ['accepted', 'rejected', 'incomplete', 'environment_error', 'timeout'];
const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'];
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const numberOrNull = value => value === null || (Number.isFinite(value) && value >= 0);
const ref = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f]/.test(value);
const issue = (diagnostics, code, path, message) => diagnostics.push({ code, path, message });

/** Stable fingerprints of explicit, non-sensitive settings and fixture manifests. */
export function fingerprint(value) {
  const seen = new Set();
  const canonical = input => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || seen.has(input)) throw new TypeError('Fingerprint requires finite acyclic JSON data');
    seen.add(input);
    const result = Array.isArray(input)
      ? input.map(canonical)
      : Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])]));
    seen.delete(input);
    return result;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function evaluationRecordKey(record) {
  return JSON.stringify([record.taskId, record.trialId, record.variant, record.attemptIndex]);
}
const trialKey = value => JSON.stringify([value.taskId, value.trialId]);
const groupKey = value => JSON.stringify([value.taskId, value.trialId, value.variant]);

export function validateEvaluationPlan(plan) {
  const diagnostics = [];
  if (!object(plan)) return [{ code: 'invalid-plan', path: 'plan', message: 'Expected an evaluation plan object.' }];
  if (plan.schemaVersion !== EVALUATION_SCHEMA_VERSION) issue(diagnostics, 'schema-version', 'plan.schemaVersion', 'Unsupported evaluation schema.');
  for (const field of ['evaluationId', 'fixtureVersion', 'criteriaVersion']) {
    if (!ID.test(plan[field] ?? '')) issue(diagnostics, 'missing-identity', `plan.${field}`, 'Expected a bounded non-sensitive identifier.');
  }
  if (!['synthetic', 'observed'].includes(plan.dataKind)) issue(diagnostics, 'data-kind', 'plan.dataKind', 'Distinguish synthetic from observed data.');
  for (const field of ['fixtureHash', 'criteriaHash']) if (!HASH.test(plan[field] ?? '')) issue(diagnostics, 'invalid-hash', `plan.${field}`, 'Expected a SHA-256 fingerprint.');
  if (!object(plan.settings)) issue(diagnostics, 'settings', 'plan.settings', 'Explicit comparison settings are required.');
  else {
    for (const field of ['modelPolicyFingerprint', 'toolsFingerprint', 'instructionsFingerprint', 'environmentFingerprint', 'retryPolicyFingerprint']) {
      if (!HASH.test(plan.settings[field] ?? '')) issue(diagnostics, 'settings', `plan.settings.${field}`, 'Expected a non-sensitive settings fingerprint.');
    }
    if (!Number.isSafeInteger(plan.settings.parallelism) || plan.settings.parallelism < 1) issue(diagnostics, 'settings', 'plan.settings.parallelism', 'A positive fixed concurrency is required.');
    for (const field of ['cachePolicy', 'sessionPolicy']) if (!ID.test(plan.settings[field] ?? '')) issue(diagnostics, 'settings', `plan.settings.${field}`, 'Record the cache/session policy as a non-sensitive identifier.');
  }
  for (const variant of VARIANTS) if (!HASH.test(plan.variants?.[variant]?.scoutSha256 ?? '')) issue(diagnostics, 'scout-definition', `plan.variants.${variant}`, 'Pin each scout definition by SHA-256.');
  if (!Array.isArray(plan.trials) || plan.trials.length < 1 || plan.trials.length > EVALUATION_LIMITS.trials) {
    issue(diagnostics, 'trial-limit', 'plan.trials', 'Supply 1 to 1000 planned task/trial pairs.');
  } else {
    const seen = new Set();
    for (const [index, trial] of plan.trials.entries()) {
      if (!object(trial) || !ID.test(trial.taskId ?? '') || !ID.test(trial.trialId ?? '') || !HASH.test(trial.startFingerprint ?? '')) {
        issue(diagnostics, 'trial-identity', `plan.trials[${index}]`, 'Task, trial and reproducible start fingerprint are required.');
        continue;
      }
      if (seen.has(trialKey(trial))) issue(diagnostics, 'duplicate-trial', `plan.trials[${index}]`, 'Planned task/trial pair is duplicated.');
      seen.add(trialKey(trial));
    }
  }
  return diagnostics;
}

/** Judgments MUST come from the caller's independently rechecked fixed oracle.
 * Never use reportedOutcome, prose, or a worker-controlled passing test as truth. */
export function validateEvaluationRecords(plan, records, judgments) {
  const diagnostics = validateEvaluationPlan(plan);
  if (diagnostics.length) return diagnostics;
  if (!Array.isArray(records) || records.length > EVALUATION_LIMITS.records) {
    issue(diagnostics, 'record-limit', 'records', 'Supply an array with at most 10000 attempts.');
    return diagnostics;
  }
  if (!(judgments instanceof Map)) {
    issue(diagnostics, 'missing-verifier', 'judgments', 'Independent fixed-oracle judgments are required.');
    return diagnostics;
  }
  const starts = new Map(plan.trials.map(trial => [trialKey(trial), trial.startFingerprint]));
  const expectedSettings = fingerprint(plan.settings);
  const groups = new Map();
  for (const [index, record] of records.entries()) {
    const path = `records[${index}]`;
    if (!object(record)) { issue(diagnostics, 'invalid-record', path, 'Expected an attempt object.'); continue; }
    for (const field of ['evaluationId', 'taskId', 'trialId']) if (!ID.test(record[field] ?? '')) issue(diagnostics, 'missing-identity', `${path}.${field}`, 'Expected a bounded non-sensitive identifier.');
    if (record.evaluationId !== plan.evaluationId) issue(diagnostics, 'evaluation-mismatch', path, 'Attempt belongs to a different evaluation.');
    if (!VARIANTS.includes(record.variant)) issue(diagnostics, 'variant', `${path}.variant`, 'Expected baseline or candidate.');
    if (!Number.isSafeInteger(record.attemptIndex) || record.attemptIndex < 1) issue(diagnostics, 'attempt-index', path, 'Attempt indices start at one and must be contiguous.');
    for (const field of ['fixtureVersion', 'criteriaVersion', 'fixtureHash', 'criteriaHash']) if (record[field] !== plan[field]) issue(diagnostics, 'fixture-mismatch', `${path}.${field}`, 'Attempt must use the pinned fixture and acceptance criteria.');
    if (!starts.has(trialKey(record))) issue(diagnostics, 'unplanned-trial', path, 'Attempt is outside the planned task/trial pairs.');
    else if (record.startFingerprint !== starts.get(trialKey(record))) issue(diagnostics, 'start-mismatch', path, 'Attempt start differs from the paired trial start.');
    if (record.settingsFingerprint !== expectedSettings) issue(diagnostics, 'settings-mismatch', path, 'Attempt model/tools/environment/cache/session settings differ.');
    if (!HASH.test(record.candidateFingerprint ?? '')) issue(diagnostics, 'candidate-fingerprint', path, 'Reproducible candidate fingerprint is required.');
    if (!object(record.scout) || record.scout.definitionSha256 !== plan.variants[record.variant]?.scoutSha256 || record.scout.loadedDefinitionSha256 !== record.scout.definitionSha256 || !HASH.test(record.scout.loadedPromptSha256 ?? '') || !ref(record.scout.evidenceRef)) {
      issue(diagnostics, 'scout-load-mismatch', path, 'Record the pinned definition and actual loaded resource evidence, not only a source edit.');
    }
    if (typeof record.final !== 'boolean') issue(diagnostics, 'final-marker', path, 'Each attempt requires an explicit final marker.');
    if (!numberOrNull(record.durationMs)) issue(diagnostics, 'duration', path, 'Duration must be a nonnegative measured number or null.');
    if (!(record.additionalSearches === null || Number.isSafeInteger(record.additionalSearches) && record.additionalSearches >= 0)) issue(diagnostics, 'search-count', path, 'Additional searches must be an observed nonnegative integer or null.');
    if (!['complete', 'partial', 'unavailable'].includes(record.usageCompleteness)) issue(diagnostics, 'usage-completeness', path, 'State whether usage covers the entire attempt, only part, or is unavailable.');
    if (record.usageCompleteness === 'complete' && !Array.isArray(record.usage)) issue(diagnostics, 'usage-completeness', path, 'A complete measurement requires normalized usage rows.');
    if (record.usageCompleteness === 'unavailable' && record.usage !== null) issue(diagnostics, 'usage-completeness', path, 'Unavailable measurement must use null usage.');
    if (!ref(record.verificationRef) || !HASH.test(record.verificationHash ?? '')) issue(diagnostics, 'missing-evidence', path, 'Fixed verification artifact reference and hash are required.');
    const judgment = judgments.get(evaluationRecordKey(record));
    if (!object(judgment) || !OUTCOMES.includes(judgment.outcome) || typeof judgment.scopeViolation !== 'boolean') issue(diagnostics, 'missing-judgment', path, 'A recomputed fixed-oracle outcome and scope judgment are required.');
    else if (judgment.evidenceSha256 !== record.verificationHash || judgment.candidateFingerprint !== record.candidateFingerprint) issue(diagnostics, 'judgment-mismatch', path, 'Verification evidence must bind to this exact candidate.');
    if (record.usage !== null) {
      if (!Array.isArray(record.usage) || record.usage.length < 1 || record.usage.length > EVALUATION_LIMITS.usageRows) issue(diagnostics, 'usage', path, 'Usage is null (unavailable) or 1 to 100 normalized model rows.');
      else for (const [rowIndex, row] of record.usage.entries()) {
        const rowPath = `${path}.usage[${rowIndex}]`;
        if (!object(row) || !LABEL.test(row.provider ?? '') || !LABEL.test(row.model ?? '')) { issue(diagnostics, 'usage-model', rowPath, 'Non-sensitive provider and model identifiers are required.'); continue; }
        if (!['pi-ai/usage-v1', 'unavailable'].includes(row.normalization)) issue(diagnostics, 'usage-normalization', rowPath, 'Use existing Pi Usage semantics, not raw provider counters.');
        if (TOKEN_FIELDS.some(field => !numberOrNull(row[field]))) issue(diagnostics, 'usage-value', rowPath, 'Each token count must be measured or explicitly null.');
        if (TOKEN_FIELDS.some(field => typeof row[field] === 'number') && (row.normalization !== 'pi-ai/usage-v1' || !ref(row.evidenceRef))) issue(diagnostics, 'usage-evidence', rowPath, 'Measured usage needs normalized Pi counters and an evidence reference.');
        if (row.normalization === 'pi-ai/usage-v1' && TOKEN_FIELDS.every(field => typeof row[field] === 'number' && numberOrNull(row[field])) && row.input + row.output + row.cacheRead + row.cacheWrite !== row.totalTokens) issue(diagnostics, 'usage-total-mismatch', rowPath, 'Complete normalized Pi counters must agree with the reported total; do not count cached input twice.');
        if (row.normalization === 'unavailable' && TOKEN_FIELDS.some(field => row[field] !== null)) issue(diagnostics, 'usage-unavailable', rowPath, 'Unavailable usage must not contain inferred zeroes.');
      }
    }
    if (!groups.has(groupKey(record))) groups.set(groupKey(record), []);
    groups.get(groupKey(record)).push({ record, index });
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.record.attemptIndex - b.record.attemptIndex);
    for (const [position, { record, index }] of group.entries()) {
      if (record.attemptIndex !== position + 1) issue(diagnostics, 'attempt-sequence', `records[${index}]`, 'Preserve first submission and every retry exactly once with contiguous indices.');
      if (position < group.length - 1 && record.final) issue(diagnostics, 'attempt-after-final', `records[${index}]`, 'No later attempt may overwrite a finalized trial.');
    }
  }
  return diagnostics;
}

// metrics.ts uses these same Pi Usage fields, adding each independently. We do
// not call its stateful ledger machinery: unlike its display defaults, unknown
// evaluation measurements must remain null. In particular do not derive total
// from provider input, caches, contextTokens, or reasoning (already in output).
function usageSummary(records) {
  const counters = Object.fromEntries(TOKEN_FIELDS.map(field => [field, { observed: 0, measured: 0, expected: 0 }]));
  const models = new Map();
  let unknownAttempts = 0;
  let partialAttempts = 0;
  for (const record of records) {
    if (record.usageCompleteness === 'partial') partialAttempts++;
    const complete = record.usageCompleteness === 'complete';
    if (!complete && Array.isArray(record.usage) && record.usage.length) for (const counter of Object.values(counters)) counter.expected++;
    if (!Array.isArray(record.usage) || record.usage.length === 0) {
      unknownAttempts++;
      for (const counter of Object.values(counters)) counter.expected++;
      continue;
    }
    for (const row of record.usage) {
      const validModel = object(row) && LABEL.test(row.provider ?? '') && LABEL.test(row.model ?? '');
      const modelKey = validModel ? JSON.stringify([row.provider, row.model]) : null;
      if (modelKey && !models.has(modelKey)) models.set(modelKey, []);
      if (modelKey) models.get(modelKey).push(row);
      for (const field of TOKEN_FIELDS) {
        counters[field].expected++;
        if (row?.normalization === 'pi-ai/usage-v1' && typeof row[field] === 'number' && numberOrNull(row[field]) && ref(row.evidenceRef)) {
          counters[field].observed += row[field];
          counters[field].measured++;
        }
      }
    }
  }
  return {
    ...Object.fromEntries(TOKEN_FIELDS.map(field => [field, records.length > 0 && counters[field].measured === counters[field].expected ? counters[field].observed : null])),
    observed: Object.fromEntries(TOKEN_FIELDS.map(field => [field, counters[field].observed])),
    coverage: Object.fromEntries(TOKEN_FIELDS.map(field => [field, { measured: counters[field].measured, expected: counters[field].expected }])),
    unknownAttempts,
    partialAttempts,
    byModel: [...models.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => ({
      provider: JSON.parse(key)[0], model: JSON.parse(key)[1],
      ...Object.fromEntries(TOKEN_FIELDS.map(field => {
        const available = rows.filter(row => row.normalization === 'pi-ai/usage-v1' && typeof row[field] === 'number' && numberOrNull(row[field]) && ref(row.evidenceRef));
        return [field, { total: available.length === rows.length && unknownAttempts === 0 && partialAttempts === 0 ? available.reduce((sum, row) => sum + row[field], 0) : null, observed: available.reduce((sum, row) => sum + row[field], 0), measured: available.length, expected: rows.length }];
      })),
    })),
    actualSubscriptionDebit: null,
  };
}

function variantSummary(plan, records, judgments, variant) {
  const attempts = records.filter(record => record.variant === variant);
  const outcomes = Object.fromEntries([...OUTCOMES, 'not_run'].map(outcome => [outcome, 0]));
  const attemptOutcomes = Object.fromEntries([...OUTCOMES, 'unverified'].map(outcome => [outcome, 0]));
  let firstAccepted = 0;
  const trials = plan.trials.map(planned => {
    const submissions = attempts.filter(record => trialKey(record) === trialKey(planned)).sort((a, b) => a.attemptIndex - b.attemptIndex);
    const verifiedOutcome = record => {
      const judgment = judgments.get(evaluationRecordKey(record));
      if (!judgment || judgment.evidenceSha256 !== record.verificationHash || judgment.candidateFingerprint !== record.candidateFingerprint || !OUTCOMES.includes(judgment.outcome)) return 'unverified';
      return judgment.scopeViolation ? 'rejected' : judgment.outcome;
    };
    for (const record of submissions) attemptOutcomes[verifiedOutcome(record)]++;
    const first = submissions.find(record => record.attemptIndex === 1);
    if (first && verifiedOutcome(first) === 'accepted') firstAccepted++;
    const last = submissions.at(-1);
    let outcome = !last ? 'not_run' : last.final ? verifiedOutcome(last) : 'incomplete';
    if (outcome === 'unverified') outcome = 'incomplete';
    outcomes[outcome]++;
    const durationMs = submissions.length && submissions.every(record => typeof record.durationMs === 'number' && numberOrNull(record.durationMs)) ? submissions.reduce((sum, record) => sum + record.durationMs, 0) : null;
    return { taskId: planned.taskId, trialId: planned.trialId, outcome, attempts: submissions.length, firstSubmissionOutcome: first ? verifiedOutcome(first) : null, durationMs };
  });
  const recordedTrials = trials.filter(trial => trial.attempts > 0).length;
  const usage = usageSummary(attempts);
  const completedTimes = trials.filter(trial => trial.outcome === 'accepted' && trial.durationMs !== null).map(trial => trial.durationMs);
  return {
    plannedTasks: new Set(plan.trials.map(trial => trial.taskId)).size,
    recordedTasks: new Set(trials.filter(trial => trial.attempts > 0).map(trial => trial.taskId)).size,
    plannedTrials: plan.trials.length, recordedTrials,
    outcomes, attemptOutcomes, attempts: attempts.length, retries: attempts.length - recordedTrials,
    firstSubmissionAcceptance: { accepted: firstAccepted, denominator: recordedTrials, plannedDenominator: plan.trials.length, rate: recordedTrials ? firstAccepted / recordedTrials : null, plannedRate: firstAccepted / plan.trials.length },
    scopeViolations: attempts.filter(record => judgments.get(evaluationRecordKey(record))?.scopeViolation === true).length,
    usage,
    totalTokensPerAcceptedTrial: outcomes.accepted && usage.totalTokens !== null ? usage.totalTokens / outcomes.accepted : null,
    completionTime: { measuredAcceptedTrials: completedTimes.length, acceptedTrials: outcomes.accepted, meanDurationMs: completedTimes.length ? completedTimes.reduce((sum, duration) => sum + duration, 0) / completedTimes.length : null },
    additionalSearches: attempts.length > 0 && attempts.every(record => typeof record.additionalSearches === 'number' && numberOrNull(record.additionalSearches)) ? attempts.reduce((sum, record) => sum + record.additionalSearches, 0) : null,
    trials,
  };
}

/** Invalid conditions remain visible and invalidate comparisons; failed attempts
 * are retained in totals. There is no model call, shell command or artifact read. */
export function aggregateEvaluation(plan, records, judgments) {
  const diagnostics = validateEvaluationRecords(plan, records, judgments);
  if (validateEvaluationPlan(plan).length || !Array.isArray(records) || records.length > EVALUATION_LIMITS.records || !(judgments instanceof Map)) return { valid: false, diagnostics, variants: null, comparison: null };
  const allowedTrials = new Set(plan.trials.map(trialKey));
  const usable = records.filter(record => object(record) && VARIANTS.includes(record.variant) && allowedTrials.has(trialKey(record)) && Number.isSafeInteger(record.attemptIndex) && record.attemptIndex > 0 && (record.usage === null || Array.isArray(record.usage) && record.usage.length <= EVALUATION_LIMITS.usageRows));
  const variants = Object.fromEntries(VARIANTS.map(variant => [variant, variantSummary(plan, usable, judgments, variant)]));
  const invalidGroups = new Set(diagnostics.flatMap(diagnostic => {
    const match = /^records\[(\d+)\]/.exec(diagnostic.path);
    return match && object(records[Number(match[1])]) ? [trialKey(records[Number(match[1])])] : [];
  }));
  const paired = [];
  const excluded = [];
  for (const [index, trial] of plan.trials.entries()) {
    const baseline = variants.baseline.trials[index];
    const candidate = variants.candidate.trials[index];
    const reason = invalidGroups.has(trialKey(trial)) ? 'invalid-record-or-conditions' : !baseline.attempts || !candidate.attempts ? 'missing-variant' : ['incomplete', 'not_run', 'environment_error'].includes(baseline.outcome) || ['incomplete', 'not_run', 'environment_error'].includes(candidate.outcome) ? 'incomplete-or-environment' : null;
    if (reason) { excluded.push({ taskId: trial.taskId, trialId: trial.trialId, reason }); continue; }
    paired.push({ taskId: trial.taskId, trialId: trial.trialId, baselineOutcome: baseline.outcome, candidateOutcome: candidate.outcome,
      completionTimeMs: baseline.outcome === 'accepted' && candidate.outcome === 'accepted' ? { baseline: baseline.durationMs, candidate: candidate.durationMs } : null });
  }
  return { schemaVersion: EVALUATION_SCHEMA_VERSION, evaluationId: plan.evaluationId, dataKind: plan.dataKind, valid: diagnostics.length === 0, diagnostics, variants,
    comparison: { comparableTrials: paired.length, paired, excluded, qualityOrUsageImprovementProven: false,
      note: plan.dataKind === 'synthetic' ? 'Synthetic aggregation checks are not model quality or usage measurements.' : 'Descriptive matched trials only; no general improvement or statistical significance claim.' } };
}
