import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateEvaluation, EVALUATION_SCHEMA_VERSION, evaluationRecordKey, fingerprint, validateEvaluationPlan, validateEvaluationRecords } from '../lib/scout-evaluation-records.mjs';

const hash = value => fingerprint(value);
function plan() {
  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION, evaluationId: 'synthetic-oracle-check', dataKind: 'synthetic',
    fixtureVersion: '1', criteriaVersion: '1', fixtureHash: hash('fixtures'), criteriaHash: hash('criteria'),
    settings: { modelPolicyFingerprint: hash('existing-roles'), toolsFingerprint: hash('tools'), instructionsFingerprint: hash('instructions'), environmentFingerprint: hash('offline'), parallelism: 1, retryPolicyFingerprint: hash('retry'), cachePolicy: 'fresh', sessionPolicy: 'isolated' },
    variants: { baseline: { scoutSha256: hash('original-scout') }, candidate: { scoutSha256: hash('enhanced-scout') } },
    trials: ['A', 'B', 'C'].map(taskId => ({ taskId, trialId: 'repeat-1', startFingerprint: hash(`start-${taskId}`) })),
  };
}
function attempt(p, taskId, attemptIndex, outcome, tokens, final = true, variant = 'candidate') {
  const record = {
    evaluationId: p.evaluationId, taskId, trialId: 'repeat-1', variant, attemptIndex,
    fixtureVersion: p.fixtureVersion, criteriaVersion: p.criteriaVersion, fixtureHash: p.fixtureHash, criteriaHash: p.criteriaHash,
    startFingerprint: p.trials.find(trial => trial.taskId === taskId).startFingerprint,
    candidateFingerprint: hash([taskId, attemptIndex, variant]), settingsFingerprint: hash(p.settings),
    scout: { definitionSha256: p.variants[variant].scoutSha256, loadedDefinitionSha256: p.variants[variant].scoutSha256, loadedPromptSha256: hash('real-loaded-prompt'), evidenceRef: 'evidence/scout-load.json' },
    verificationRef: 'evidence/verification.json', verificationHash: hash([taskId, attemptIndex, variant, outcome]), final,
    reportedOutcome: 'accepted', durationMs: 100, additionalSearches: 0, usageCompleteness: 'complete',
    usage: [{ provider: 'synthetic', model: 'arithmetic-fixture', normalization: 'pi-ai/usage-v1', input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens, evidenceRef: 'evidence/usage.json' }],
  };
  return { record, judgment: { outcome, scopeViolation: false, evidenceSha256: record.verificationHash, candidateFingerprint: record.candidateFingerprint } };
}
function dataset(variant = 'candidate') {
  const p = plan();
  const pairs = [attempt(p, 'A', 1, 'accepted', 10, true, variant), attempt(p, 'B', 1, 'rejected', 20, false, variant), attempt(p, 'B', 2, 'accepted', 30, true, variant), attempt(p, 'C', 1, 'rejected', 7, true, variant)];
  return { p, records: pairs.map(pair => pair.record), judgments: new Map(pairs.map(pair => [evaluationRecordKey(pair.record), pair.judgment])) };
}

test('required synthetic case preserves first failure and all attempts: 67 / 2 = 33.5', () => {
  const { p, records, judgments } = dataset();
  assert.deepEqual(validateEvaluationPlan(p), []);
  assert.deepEqual(validateEvaluationRecords(p, records, judgments), []);
  const before = JSON.stringify([p, records, [...judgments]]);
  const report = aggregateEvaluation(p, records, judgments);
  const result = report.variants.candidate;
  assert.equal(report.valid, true);
  assert.equal(report.dataKind, 'synthetic');
  assert.equal(result.plannedTasks, 3);
  assert.equal(result.recordedTrials, 3);
  assert.equal(result.outcomes.accepted, 2);
  assert.equal(result.outcomes.rejected, 1);
  assert.equal(result.attempts, 4);
  assert.equal(result.retries, 1);
  assert.deepEqual(result.firstSubmissionAcceptance, { accepted: 1, denominator: 3, plannedDenominator: 3, rate: 1 / 3, plannedRate: 1 / 3 });
  assert.equal(result.trials[1].firstSubmissionOutcome, 'rejected');
  assert.equal(result.usage.totalTokens, 67);
  assert.equal(result.totalTokensPerAcceptedTrial, 33.5);
  assert.equal(result.completionTime.meanDurationMs, 150);
  assert.equal(result.usage.actualSubscriptionDebit, null);
  assert.equal(report.variants.baseline.outcomes.not_run, 3);
  assert.equal(report.comparison.comparableTrials, 0);
  assert.equal(report.comparison.qualityOrUsageImprovementProven, false);
  assert.equal(JSON.stringify([p, records, [...judgments]]), before);
  assert.deepEqual(aggregateEvaluation(p, records, judgments), report);
});

test('settings fingerprint is order independent and rejects non-JSON data', () => {
  assert.equal(hash({ b: 2, a: 1 }), hash({ a: 1, b: 2 }));
  assert.notEqual(hash({ a: 1 }), hash({ a: 2 }));
  assert.throws(() => hash({ a: undefined }), /finite acyclic JSON/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => hash(cyclic), /finite acyclic JSON/);
});

test('unrecorded planned trials have unknown usage, not a measured zero', () => {
  const p = plan();
  const report = aggregateEvaluation(p, [], new Map());
  assert.equal(report.valid, true);
  for (const variant of ['baseline', 'candidate']) {
    const result = report.variants[variant];
    assert.equal(result.outcomes.not_run, 3);
    assert.equal(result.recordedTrials, 0);
    assert.equal(result.additionalSearches, null);
    assert.equal(result.usage.totalTokens, null);
    assert.equal(result.usage.input, null);
    assert.equal(result.usage.observed.totalTokens, 0);
    assert.deepEqual(result.usage.coverage.totalTokens, { measured: 0, expected: 0 });
  }
});

test('missing identifiers, evidence or independent judgment never accept self-assessment', () => {
  for (const field of ['taskId', 'candidateFingerprint', 'verificationRef', 'verificationHash']) {
    const { p, records, judgments } = dataset();
    delete records[0][field];
    assert.equal(aggregateEvaluation(p, records, judgments).valid, false, field);
  }
  const { p, records, judgments } = dataset();
  judgments.delete(evaluationRecordKey(records[0]));
  const report = aggregateEvaluation(p, records, judgments);
  assert.equal(report.valid, false);
  assert.equal(report.variants.candidate.trials[0].outcome, 'incomplete');
  assert.equal(report.variants.candidate.trials[2].outcome, 'rejected');
  assert(validateEvaluationRecords(p, records, null).some(issue => issue.code === 'missing-verifier'));
});

test('fixture, start, settings and actually loaded scout mismatches refuse paired comparison', () => {
  for (const mutate of [
    record => { record.fixtureVersion = '2'; },
    record => { record.criteriaHash = hash('other-criteria'); },
    record => { record.startFingerprint = hash('other-start'); },
    record => { record.settingsFingerprint = hash('different-model'); },
    record => { record.scout.loadedDefinitionSha256 = hash('stale-install'); },
  ]) {
    const { p, records, judgments } = dataset();
    const baseline = dataset('baseline');
    records.push(...baseline.records);
    for (const [key, value] of baseline.judgments) judgments.set(key, value);
    mutate(records[0]);
    const report = aggregateEvaluation(p, records, judgments);
    assert.equal(report.valid, false);
    assert.equal(report.comparison.comparableTrials, 2);
    assert.equal(report.comparison.excluded[0].reason, 'invalid-record-or-conditions');
    assert.equal(report.variants.candidate.usage.totalTokens, 67, 'mismatched evidence is visible, not dropped from cost');
  }
});

test('paired report compares equal-condition trials without asserting a model improvement', () => {
  const { p, records, judgments } = dataset();
  const baseline = dataset('baseline');
  records.push(...baseline.records);
  for (const [key, value] of baseline.judgments) judgments.set(key, value);
  const report = aggregateEvaluation(p, records, judgments);
  assert.equal(report.valid, true);
  assert.equal(report.comparison.comparableTrials, 3);
  assert.deepEqual(report.comparison.paired[1].completionTimeMs, { baseline: 200, candidate: 200 });
  assert.equal(report.comparison.paired[2].completionTimeMs, null, 'failure is not a completion');
  assert.equal(report.comparison.qualityOrUsageImprovementProven, false);
});

test('all failures retain usage and never divide by zero', () => {
  const { p, records, judgments } = dataset();
  for (const judgment of judgments.values()) judgment.outcome = 'rejected';
  const result = aggregateEvaluation(p, records, judgments).variants.candidate;
  assert.equal(result.outcomes.rejected, 3);
  assert.equal(result.usage.totalTokens, 67);
  assert.equal(result.totalTokensPerAcceptedTrial, null);
  assert.equal(result.completionTime.meanDurationMs, null);
});

test('unknown and partial usage are null totals with measured subtotal and explicit coverage', () => {
  const { p, records, judgments } = dataset();
  records[3].usage = null;
  records[3].usageCompleteness = 'unavailable';
  records[1].durationMs = null;
  let report = aggregateEvaluation(p, records, judgments);
  assert.equal(report.valid, true);
  assert.equal(report.variants.candidate.usage.totalTokens, null);
  assert.equal(report.variants.candidate.usage.observed.totalTokens, 60);
  assert.deepEqual(report.variants.candidate.usage.coverage.totalTokens, { measured: 3, expected: 4 });
  assert.equal(report.variants.candidate.totalTokensPerAcceptedTrial, null);
  assert.equal(report.variants.candidate.completionTime.measuredAcceptedTrials, 1);
  const partial = dataset();
  partial.records[0].usageCompleteness = 'partial';
  report = aggregateEvaluation(partial.p, partial.records, partial.judgments);
  assert.equal(report.valid, true);
  assert.equal(report.variants.candidate.usage.totalTokens, null);
  assert.equal(report.variants.candidate.usage.observed.totalTokens, 67);
  assert.equal(report.variants.candidate.usage.partialAttempts, 1);
});

test('normalized Pi fields sum independently, without adding cache or reasoning twice', () => {
  const { p, records, judgments } = dataset();
  records[0].usage[0] = { ...records[0].usage[0], input: 1, cacheRead: 5, cacheWrite: 2, output: 2, totalTokens: 10, reasoning: 1 };
  const usage = aggregateEvaluation(p, records, judgments).variants.candidate.usage;
  assert.equal(usage.totalTokens, 67);
  assert.equal(usage.input, 58);
  assert.equal(usage.cacheRead, 5);
  assert.equal(usage.cacheWrite, 2);
  assert.equal(usage.output, 2);
  delete records[0].usage[0].totalTokens;
  assert.equal(aggregateEvaluation(p, records, judgments).valid, false);
  assert.equal(aggregateEvaluation(p, records, judgments).variants.candidate.usage.totalTokens, null);
});

test('complete normalized usage must agree with reported total but missing counters are not inferred', () => {
  const { p, records, judgments } = dataset();
  records[0].usage[0] = { ...records[0].usage[0], input: 10, output: 0, cacheRead: 5, cacheWrite: 0, totalTokens: 10 };
  assert(validateEvaluationRecords(p, records, judgments).some(issue => issue.code === 'usage-total-mismatch'));
  records[0].usage[0].input = null;
  const report = aggregateEvaluation(p, records, judgments);
  assert.equal(report.valid, true);
  assert.equal(report.variants.candidate.usage.input, null);
  assert.equal(report.variants.candidate.usage.totalTokens, 67);
});

test('environment problems, timeout, not-run and incomplete trials are not hidden as ordinary failure', () => {
  const { p, records, judgments } = dataset();
  judgments.get(evaluationRecordKey(records[0])).outcome = 'environment_error';
  judgments.get(evaluationRecordKey(records[3])).outcome = 'timeout';
  records[2].final = false;
  const result = aggregateEvaluation(p, records, judgments).variants.candidate;
  assert.equal(result.outcomes.environment_error, 1);
  assert.equal(result.outcomes.timeout, 1);
  assert.equal(result.outcomes.incomplete, 1);
  assert.equal(result.usage.totalTokens, 67);
});

test('first submission cannot be replaced through duplicate, missing or after-final attempts', () => {
  for (const mutate of [
    records => records.push({ ...records[0] }),
    records => { records.splice(1, 1); },
    records => { records[1].final = true; },
  ]) {
    const { p, records, judgments } = dataset();
    mutate(records);
    assert(validateEvaluationRecords(p, records, judgments).some(issue => ['attempt-sequence', 'attempt-after-final'].includes(issue.code)));
  }
});

test('scope violation overrides acceptance, mismatched evidence cannot authorize success', () => {
  const { p, records, judgments } = dataset();
  judgments.get(evaluationRecordKey(records[0])).scopeViolation = true;
  judgments.get(evaluationRecordKey(records[2])).evidenceSha256 = hash('wrong');
  const report = aggregateEvaluation(p, records, judgments);
  assert.equal(report.valid, false);
  assert.equal(report.variants.candidate.trials[0].outcome, 'rejected');
  assert.equal(report.variants.candidate.trials[1].outcome, 'incomplete');
  assert.equal(report.variants.candidate.scopeViolations, 1);
});

test('malformed and over-budget records produce bounded value-free diagnostics, not execution', () => {
  const { p, records, judgments } = dataset();
  records[0].shellCommand = 'echo DO_NOT_EXECUTE_SENSITIVE';
  records[0].rawPrompt = 'DO_NOT_COPY_SENSITIVE';
  assert.equal(aggregateEvaluation(p, records, judgments).valid, true);
  assert.doesNotMatch(JSON.stringify(aggregateEvaluation(p, records, judgments)), /DO_NOT_/);
  records[0].usage[0].provider = 'DO_NOT_COPY_SENSITIVE\n';
  const invalid = aggregateEvaluation(p, records, judgments);
  assert.equal(invalid.valid, false);
  assert.doesNotMatch(JSON.stringify(invalid), /DO_NOT_/);
  assert.equal(aggregateEvaluation(p, Array(10001).fill(null), judgments).valid, false);
  assert.equal(aggregateEvaluation(null, [], new Map()).valid, false);
  assert.equal(aggregateEvaluation(p, [null], new Map()).valid, false);
});
