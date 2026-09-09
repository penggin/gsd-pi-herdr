#!/usr/bin/env node
// Explicit offline evaluation entrypoint; it never launches GSD or a model.
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { aggregateEvaluation, EVALUATION_LIMITS, evaluationRecordKey, fingerprint, validateEvaluationPlan } from './lib/scout-evaluation-records.mjs';
import { REPO, FIXTURE_DIR, artifactPath, judgeSubmission, loadSuite, prepareWorkspace, readBounded, readJson, sha256, snapshotWorkspace, taskFixture } from './lib/scout-evaluation-workspace.mjs';
import { redactSecrets } from '../src/resources/extensions/gsd/redact-secrets.ts';

const demand = (condition, message) => { if (!condition) throw new Error(message); };
const json = value => JSON.stringify(value, null, 2) + '\n';
function writeNew(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filename, typeof value === 'string' ? value : json(value), { flag: 'wx', mode: 0o600 });
}
export function probeScout(workspace) {
  const root = fs.realpathSync(workspace);
  artifactPath(root, '.gsd/agents/scout.md');
  const home = fs.mkdtempSync(path.join(tmpdir(), 'gsd-scout-probe-'));
  try {
    const result = spawnSync(process.execPath, [
      '--import', path.join(REPO, 'src/resources/extensions/gsd/tests/resolve-ts.mjs'), '--experimental-strip-types',
      path.join(REPO, 'scripts/scout-evaluation-probe.mjs'), root,
    ], {
      cwd: REPO, shell: false, encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024,
      env: { PATH: path.dirname(process.execPath), HOME: home, USERPROFILE: home, GSD_HOME: path.join(home, '.gsd'), GSD_CODING_AGENT_DIR: path.join(home, '.gsd/agent'), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    });
    demand(result.status === 0 && !result.error, 'Isolated scout discovery probe failed; no model was called');
    return JSON.parse(result.stdout);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
export function initializeEvaluation(directory, settings, synthetic = false) {
  const suite = loadSuite();
  demand(!fs.existsSync(directory), 'Evaluation directory already exists');
  for (const key of ['modelPolicy', 'tools', 'instructions', 'environment', 'retryPolicy']) demand(settings[key] !== undefined, 'Explicit public comparison settings are required');
  const repetitions = settings.repetitions ?? 1;
  demand(Number.isSafeInteger(repetitions) && repetitions >= 1 && repetitions <= 20, 'repetitions must be 1 to 20');
  const baseline = readBounded(path.join(FIXTURE_DIR, 'baseline-scout.md')).toString('utf8');
  const candidate = readBounded(path.join(REPO, 'src/resources/agents/scout.md')).toString('utf8');
  const config = {
    ...Object.fromEntries(['modelPolicy', 'tools', 'instructions', 'environment', 'retryPolicy'].map(key => [key + 'Fingerprint', fingerprint(settings[key])])),
    parallelism: settings.parallelism, cachePolicy: settings.cachePolicy, sessionPolicy: settings.sessionPolicy,
  };
  const plan = {
    schemaVersion: 'gsd.scout-eval/v1', evaluationId: settings.evaluationId, dataKind: synthetic ? 'synthetic' : 'observed',
    ...Object.fromEntries(['fixtureVersion', 'criteriaVersion', 'fixtureHash', 'criteriaHash'].map(k => [k, suite.identity[k]])),
    settings: config,
    variants: { baseline: { scoutSha256: sha256(baseline), definitionRef: 'definitions/baseline-scout.md' }, candidate: { scoutSha256: sha256(candidate), definitionRef: 'definitions/candidate-scout.md' } },
    trials: suite.fixtures.tasks.flatMap(task => Array.from({ length: repetitions }, (_, index) => ({ taskId: task.id, trialId: `repeat-${index + 1}`, startFingerprint: fingerprint(task.files) }))),
  };
  demand(!validateEvaluationPlan(plan).length, 'Invalid evaluation settings');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeNew(path.join(directory, 'definitions/baseline-scout.md'), baseline);
  writeNew(path.join(directory, 'definitions/candidate-scout.md'), candidate);
  writeNew(path.join(directory, 'plan.json'), plan);
  writeNew(path.join(directory, 'plan.sha256'), sha256(json(plan)) + '\n');
  return plan;
}
export function loadPlan(filename) {
  const root = fs.realpathSync(path.dirname(filename));
  const planBytes = readBounded(filename), plan = JSON.parse(planBytes);
  demand(sha256(planBytes) === readBounded(path.join(root, 'plan.sha256'), 100).toString('utf8').trim(), 'Plan changed after initialization; create a new evaluation');
  demand(!validateEvaluationPlan(plan).length, 'Invalid evaluation plan');
  const suite = loadSuite();
  for (const k of ['fixtureVersion', 'criteriaVersion', 'fixtureHash', 'criteriaHash']) demand(plan[k] === suite.identity[k], 'Evaluation fixture or criteria drift');
  for (const trial of plan.trials) demand(trial.startFingerprint === fingerprint(taskFixture(suite, trial.taskId).files), 'Fixture start mismatch');
  for (const variant of Object.values(plan.variants)) demand(sha256(readBounded(artifactPath(root, variant.definitionRef))) === variant.scoutSha256, 'Pinned scout definition changed');
  return { root, plan, suite };
}
export function verifyAttempt(planFile, taskId, trialId, variant, attemptIndex, workspaceRef, reviewRef) {
  const { root, plan, suite } = loadPlan(planFile);
  demand(plan.trials.some(t => t.taskId === taskId && t.trialId === trialId) && ['baseline', 'candidate'].includes(variant) && Number.isSafeInteger(attemptIndex) && attemptIndex >= 1 && attemptIndex <= 1000, 'Verification must identify a planned task/trial/variant/attempt');
  const identity = { evaluationId: plan.evaluationId, taskId, trialId, variant, attemptIndex };
  const receiptRef = `verification/${taskId}/${trialId}/${variant}/${attemptIndex}.json`;
  if (attemptIndex > 1) artifactPath(root, `verification/${taskId}/${trialId}/${variant}/${attemptIndex - 1}.json`);
  const workspace = artifactPath(root, workspaceRef), reviewPath = artifactPath(root, reviewRef);
  demand(!reviewPath.startsWith(workspace + path.sep), 'Evaluator review must be outside the candidate workspace');
  const out = artifactPath(root, receiptRef, { mustExist: false });
  demand(!out.startsWith(workspace + path.sep), 'Verification output must be outside candidate workspace');
  const review = readJson(reviewPath), before = snapshotWorkspace(workspace);
  demand(Object.entries(identity).every(([key, value]) => review[key] === value), 'Evaluator review attempt identity mismatch');
  const judgment = judgeSubmission(suite, taskId, workspace, review);
  const scout = probeScout(workspace);
  demand(plan.variants[variant].scoutSha256 === scout.loadedDefinitionSha256, 'Workspace loaded an unpinned or wrong-variant scout');
  const snapshotRef = receiptRef + '.workspace', frozenReviewRef = receiptRef + '.review.json', loadRef = receiptRef + '.scout.json';
  const frozen = artifactPath(root, snapshotRef, { mustExist: false });
  demand(!fs.existsSync(out) && !fs.existsSync(frozen), 'Never overwrite first submission evidence');
  for (const [file, text] of Object.entries(before.files)) writeNew(path.join(frozen, file), text);
  writeNew(path.join(frozen, '.gsd/agents/scout.md'), readBounded(path.join(workspace, '.gsd/agents/scout.md')).toString('utf8'));
  demand(sha256(readBounded(path.join(frozen, '.gsd/agents/scout.md'))) === scout.loadedDefinitionSha256, 'Scout changed during snapshot');
  writeNew(artifactPath(root, frozenReviewRef, { mustExist: false }), review);
  writeNew(artifactPath(root, loadRef, { mustExist: false }), scout);
  demand(snapshotWorkspace(workspace).fingerprint === before.fingerprint && snapshotWorkspace(frozen).fingerprint === before.fingerprint, 'Candidate changed during verification snapshot');
  const receipt = {
    schemaVersion: 'gsd.scout-verification/v1', ...identity, dataKind: plan.dataKind,
    fixtureHash: plan.fixtureHash, criteriaHash: plan.criteriaHash, workspaceRef: snapshotRef, reviewRef: frozenReviewRef,
    scoutRef: loadRef, scout, reviewSha256: sha256(readBounded(artifactPath(root, frozenReviewRef))), ...judgment,
    reviewBoundary: 'operator-authored fixed rubric; file separation is not a security sandbox',
  };
  writeNew(out, receipt);
  return { verificationRef: receiptRef, verificationHash: sha256(readBounded(out)), candidateFingerprint: receipt.candidateFingerprint, outcome: receipt.outcome, scopeViolation: receipt.scopeViolation, scout: { ...scout, evidenceRef: loadRef } };
}

// Reconcile only the known, shallow receipt directories. Never descend into
// frozen workspaces or discover user sessions. Omitted failed submissions are
// missing measurements, not zero-cost "not run" trials.
function receiptInventory(root, plan, records) {
  const supplied = new Set(records.filter(r => r && typeof r === 'object').map(r => r.verificationRef));
  const missing = [], diagnostics = [];
  let entries = 0, receipts = 0;
  try {
    for (const trial of plan.trials) for (const variant of ['baseline', 'candidate']) {
      const relative = `verification/${trial.taskId}/${trial.trialId}/${variant}`;
      const directory = artifactPath(root, relative, { mustExist: false });
      if (!fs.existsSync(directory)) continue;
      const handle = fs.opendirSync(directory);
      try {
        for (let entry; (entry = handle.readSync());) {
          demand(++entries <= EVALUATION_LIMITS.records * 4, 'Receipt inventory entry bound exceeded');
          if (!/^\d+\.json$/.test(entry.name)) continue;
          demand(entry.isFile() && !entry.isSymbolicLink() && ++receipts <= EVALUATION_LIMITS.records, 'Unsafe or excessive receipt inventory');
          const index = Number(entry.name.slice(0, -5));
          demand(Number.isSafeInteger(index) && index >= 1 && index <= 1000 && entry.name === `${index}.json`, 'Noncanonical receipt inventory');
          const ref = `${relative}/${entry.name}`;
          if (!supplied.has(ref)) missing.push({ variant, ref });
        }
      } finally { handle.closeSync(); }
    }
  } catch {
    diagnostics.push({ code: 'receipt-inventory', path: 'verification', message: 'Receipt inventory is unsafe, inaccessible or exceeds its finite scan bound; completeness cannot be established.' });
  }
  for (const { ref } of missing.sort((a, b) => a.ref.localeCompare(b.ref))) diagnostics.push({ code: 'omitted-verified-attempt', path: ref, message: 'A canonical verification receipt is omitted from the supplied records; preserve the submission and its measured or unavailable usage.' });
  return { missing, diagnostics };
}

export function reportEvaluation(planFile, recordsFile, dryRun = false) {
  const { root, plan, suite } = loadPlan(planFile);
  const records = readJson(recordsFile); demand(Array.isArray(records) && records.length <= 10000, 'Expected a bounded attempt array');
  const judgments = new Map(), artifactDiagnostics = [];
  const inventory = receiptInventory(root, plan, records);
  artifactDiagnostics.push(...inventory.diagnostics);
  for (const [index, record] of records.entries()) {
    try {
      const evidence = readBounded(artifactPath(root, record.verificationRef));
      demand(sha256(evidence) === record.verificationHash, 'Verification hash mismatch');
      const receipt = JSON.parse(evidence);
      demand(receipt.schemaVersion === 'gsd.scout-verification/v1' && receipt.evaluationId === plan.evaluationId && receipt.taskId === record.taskId && receipt.dataKind === plan.dataKind && receipt.fixtureHash === plan.fixtureHash && receipt.criteriaHash === plan.criteriaHash, 'Receipt binding mismatch');
      demand(['trialId', 'variant', 'attemptIndex'].every(key => receipt[key] === record[key]) && record.verificationRef === `verification/${record.taskId}/${record.trialId}/${record.variant}/${record.attemptIndex}.json`, 'Verification receipt was relabeled or replayed');
      const workspace = artifactPath(root, receipt.workspaceRef), reviewPath = artifactPath(root, receipt.reviewRef);
      demand(!reviewPath.startsWith(workspace + path.sep), 'Self-review is not evaluator evidence');
      demand(sha256(readBounded(reviewPath)) === receipt.reviewSha256, 'Frozen review changed');
      const review = readJson(reviewPath);
      demand(['evaluationId', 'taskId', 'trialId', 'variant', 'attemptIndex'].every(k => review[k] === record[k]), 'Frozen review identity mismatch');
      const judgment = judgeSubmission(suite, record.taskId, workspace, review);
      for (const key of ['outcome', 'scopeViolation', 'candidateFingerprint', 'handoffSha256']) demand(judgment[key] === receipt[key], 'Fixed oracle no longer agrees with receipt');
      const scout = readJson(artifactPath(root, record.scout.evidenceRef));
      demand(record.scout.evidenceRef === receipt.scoutRef && fingerprint(scout) === fingerprint(receipt.scout), 'Scout evidence changed');
      demand(sha256(readBounded(artifactPath(workspace, '.gsd/agents/scout.md'))) === scout.definitionSha256, 'Frozen scout differs from discovery evidence');
      for (const key of ['definitionSha256', 'loadedDefinitionSha256', 'loadedPromptSha256']) demand(record.scout[key] === scout[key], 'Recorded scout identity mismatch');
      // Real runs additionally need evaluator-attested prompt/launch provenance.
      // A loader probe alone is never claimed to prove a live model run used it.
      if (plan.dataKind === 'observed') {
        const launch = readJson(artifactPath(root, record.scout.runEvidenceRef));
        demand(launch.kind === 'operator-observed-gsd-launch' && ['evaluationId', 'taskId', 'trialId', 'variant', 'attemptIndex'].every(k => launch[k] === record[k]) && launch.loadedPromptSha256 === scout.loadedPromptSha256 && launch.settingsFingerprint === record.settingsFingerprint && typeof launch.gsdRunId === 'string' && launch.gsdRunId.length > 0, 'Observed run lacks bound GSD launch evidence');
      }
      const usageArtifacts = new Map();
      const usageFields = ['provider', 'model', 'input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'];
      if (Array.isArray(record.usage)) for (const row of record.usage) if (row.normalization === 'pi-ai/usage-v1') {
        if (!usageArtifacts.has(row.evidenceRef)) {
          const usage = readJson(artifactPath(root, row.evidenceRef));
          demand(usage.kind === 'normalized-pi-usage' && usage.evaluationId === record.evaluationId && usage.taskId === record.taskId && usage.trialId === record.trialId && usage.variant === record.variant && usage.attemptIndex === record.attemptIndex, 'Usage evidence belongs to another attempt');
          demand(Array.isArray(usage.rows) && usage.rows.length <= EVALUATION_LIMITS.usageRows, 'Expected bounded normalized usage rows');
          usageArtifacts.set(row.evidenceRef, usage.rows.slice());
        }
        const remaining = usageArtifacts.get(row.evidenceRef);
        const match = remaining.findIndex(r => r && usageFields.every(k => r[k] === row[k]));
        demand(match >= 0, 'Usage row is missing from evidence or repeats a measured row');
        remaining.splice(match, 1);
      }
      if (record.usageCompleteness === 'complete') {
        demand(Array.isArray(record.usage) && record.usage.length > 0 && new Set(record.usage.map(row => row.evidenceRef)).size === 1, 'Complete usage needs one complete attempt artifact');
        const evidence = readJson(artifactPath(root, record.usage[0].evidenceRef));
        const fields = rows => rows.map(row => Object.fromEntries(['provider', 'model', 'input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].map(key => [key, row[key]])));
        demand(fingerprint(fields(evidence.rows)) === fingerprint(fields(record.usage)), 'Complete usage omitted or duplicated measured rows');
      }
      judgments.set(evaluationRecordKey(record), { ...judgment, evidenceSha256: record.verificationHash });
    } catch {
      artifactDiagnostics.push({ code: 'artifact-verification', path: `records[${index}]`, message: 'Missing, unsafe, changed or mismatched evaluator/scout/usage evidence.' });
    }
  }
  const report = aggregateEvaluation(plan, records, judgments);
  // The recorded subtotal remains useful, but missing submissions must not be
  // presented as a complete total or as a cost-per-success measurement.
  if (report.variants) for (const variant of ['baseline', 'candidate']) {
    const missing = inventory.missing.filter(item => item.variant === variant).length;
    const scanUnknown = inventory.diagnostics.some(item => item.code === 'receipt-inventory');
    if (!missing && !scanUnknown) continue;
    const summary = report.variants[variant];
    summary.omittedVerifiedAttempts = missing;
    summary.usage.unknownAttempts += missing;
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) {
      summary.usage[field] = null;
      summary.usage.coverage[field].expected += missing;
      for (const model of summary.usage.byModel) model[field].total = null;
    }
    summary.totalTokensPerAcceptedTrial = null;
  }
  report.valid &&= artifactDiagnostics.length === 0;
  report.diagnostics.push(...artifactDiagnostics);
  report.dryRun = dryRun;
  return report;
}

export function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (command === 'fixtures') { const s = loadSuite(); return { ...s.identity, synthetic: true, tasks: s.fixtures.tasks.map(t => ({ id: t.id, startFingerprint: fingerprint(t.files), environment: t.environment })) }; }
  if (command === 'init') return initializeEvaluation(path.resolve(rest[0]), readJson(path.resolve(rest[1])), rest.includes('--synthetic'));
  if (command === 'prepare') {
    const { root, plan, suite } = loadPlan(path.resolve(rest[0]));
    demand(['baseline', 'candidate'].includes(rest[2]), 'Variant must be baseline or candidate');
    return prepareWorkspace(suite, rest[1], artifactPath(root, rest[3], { mustExist: false }), readBounded(artifactPath(root, plan.variants[rest[2]].definitionRef)).toString('utf8'));
  }
  if (command === 'probe') return probeScout(path.resolve(rest[0]));
  if (command === 'verify') return verifyAttempt(path.resolve(rest[0]), rest[1], rest[2], rest[3], Number(rest[4]), rest[5], rest[6]);
  if (command === 'validate' || command === 'report') {
    if (!rest[1]) { const { plan } = loadPlan(path.resolve(rest[0])); return { valid: true, evaluationId: plan.evaluationId, plannedTrials: plan.trials.length }; }
    return reportEvaluation(path.resolve(rest[0]), path.resolve(rest[1]), rest.includes('--dry-run'));
  }
  throw new Error('Usage: scout-evaluation.mjs fixtures | init DIR SETTINGS [--synthetic] | prepare PLAN TASK VARIANT NEW_REL_DIR | probe WORKSPACE | verify PLAN TASK TRIAL VARIANT ATTEMPT WORKSPACE_REF REVIEW_REF | validate/report PLAN [RECORDS] [--dry-run]');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { const result = main(); process.stdout.write(redactSecrets(json(result))); if (result.valid === false) process.exitCode = 2; }
  catch (error) { process.stderr.write(redactSecrets(String(error.message)) + '\n'); process.exitCode = 2; }
}
