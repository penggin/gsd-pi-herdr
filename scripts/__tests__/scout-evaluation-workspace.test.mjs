import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { initializeEvaluation, loadPlan, probeScout, reportEvaluation, verifyAttempt } from '../scout-evaluation.mjs';
import { REPO, artifactPath, judgeSubmission, loadSuite, prepareWorkspace, sha256, snapshotWorkspace } from '../lib/scout-evaluation-workspace.mjs';
import { fingerprint } from '../lib/scout-evaluation-records.mjs';

const settings = {
  evaluationId: 'synthetic-cli-proof', modelPolicy: { source: 'synthetic-no-model' }, tools: ['read', 'grep'],
  instructions: { fixture: 'v1' }, environment: { node: 'fixture', network: 'none' }, retryPolicy: { limit: 2 },
  parallelism: 1, cachePolicy: 'fresh', sessionPolicy: 'isolated',
};
function experiment(t, synthetic = true) {
  const tmp = fs.mkdtempSync(path.join(tmpdir(), 'gsd-scout-evaluation-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const dir = path.join(tmp, 'evaluation');
  const plan = initializeEvaluation(dir, settings, synthetic);
  return { dir, plan, planFile: path.join(dir, 'plan.json'), suite: loadSuite() };
}
// Explicit synthetic handoffs and evaluator reviews, not model measurements or
// expected answer text bundled into the user's task request.
function submission(e, taskId, attemptIndex, accepted, tokens, final = true, variant = 'candidate', condition = 'submission') {
  const key = `${taskId}-${variant}-${attemptIndex}`;
  const workspaceRef = `work/${key}`, reviewRef = `reviews/${key}.json`, receiptRef = `verification/${taskId}/repeat-1/${variant}/${attemptIndex}.json`;
  const workspace = path.join(e.dir, workspaceRef);
  const task = e.suite.fixtures.tasks.find(t => t.id === taskId);
  prepareWorkspace(e.suite, taskId, workspace, fs.readFileSync(path.join(e.dir, e.plan.variants[variant].definitionRef), 'utf8'));
  const citations = e.suite.criteria.tasks[taskId].evidencePaths.map(file => {
    const endLine = task.files[file].trimEnd().split('\n').length;
    return { path: file, startLine: 1, endLine, sourceQuote: task.files[file].split('\n').slice(0, endLine).join('\n'), handoffQuote: `${file}:1-${endLine}` };
  });
  const handoff = 'Synthetic handoff for evaluator tests only.\n' + citations.map(c => c.handoffQuote).join('\n') + '\nSynthetic fixed-rubric witness.\nMissing contract stays unverified.\n';
  if (condition === 'submission') fs.writeFileSync(path.join(workspace, 'handoff.md'), handoff);
  const snap = snapshotWorkspace(workspace);
  const review = {
    schemaVersion: 'gsd.scout-review/v1', author: 'evaluator', reviewerId: 'synthetic-test', taskId,
    evaluationId: e.plan.evaluationId, trialId: 'repeat-1', variant, attemptIndex,
    fixtureHash: e.plan.fixtureHash, criteriaHash: e.plan.criteriaHash, candidateFingerprint: snap.fingerprint,
    handoffSha256: sha256(condition === 'submission' ? handoff : ''), condition, conditionReason: 'Synthetic condition', citations,
    checks: Object.fromEntries(e.suite.criteria.tasks[taskId].checks.map((check, index) => [check, { pass: accepted || index !== 0, evidence: 'Synthetic fixed-rubric witness.' }])),
    sufficiency: { value: taskId === 'C-missing-contract' ? 'gaps_remaining' : 'sufficient_for_requested_scope', evidence: 'Missing contract stays unverified.' },
    stopReason: { value: taskId === 'C-missing-contract' ? 'unavailable' : 'enough-evidence', evidence: 'Synthetic fixed-rubric witness.' },
  };
  fs.mkdirSync(path.dirname(path.join(e.dir, reviewRef)), { recursive: true });
  fs.writeFileSync(path.join(e.dir, reviewRef), JSON.stringify(review));
  const verified = verifyAttempt(e.planFile, taskId, 'repeat-1', variant, attemptIndex, workspaceRef, reviewRef);
  const usageRef = `evidence/${key}.usage.json`;
  const usage = { provider: 'synthetic', model: 'arithmetic-only', input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens };
  fs.mkdirSync(path.dirname(path.join(e.dir, usageRef)), { recursive: true });
  fs.writeFileSync(path.join(e.dir, usageRef), JSON.stringify({ kind: 'normalized-pi-usage', evaluationId: e.plan.evaluationId, taskId, trialId: 'repeat-1', variant, attemptIndex, rows: [usage] }));
  const record = {
    evaluationId: e.plan.evaluationId, taskId, trialId: 'repeat-1', variant, attemptIndex,
    ...Object.fromEntries(['fixtureVersion', 'criteriaVersion', 'fixtureHash', 'criteriaHash'].map(k => [k, e.plan[k]])),
    startFingerprint: fingerprint(task.files), settingsFingerprint: fingerprint(e.plan.settings),
    candidateFingerprint: verified.candidateFingerprint, scout: verified.scout,
    verificationRef: receiptRef, verificationHash: verified.verificationHash,
    final, durationMs: 100, additionalSearches: null, usageCompleteness: 'complete',
    usage: [{ ...usage, normalization: 'pi-ai/usage-v1', evidenceRef: usageRef }], reportedOutcome: 'accepted',
  };
  return { record, review, workspace, workspaceRef, reviewRef, receiptRef, verified };
}
function saveRecords(e, records) {
  const file = path.join(e.dir, 'records.json'); fs.writeFileSync(file, JSON.stringify(records)); return file;
}

test('fixed fixture/oracle lock, baseline and candidate discovery work with no global resource changes', t => {
  const e = experiment(t);
  const identities = [];
  for (const variant of ['baseline', 'candidate']) {
    const root = path.join(e.dir, variant);
    const definition = fs.readFileSync(path.join(e.dir, e.plan.variants[variant].definitionRef), 'utf8');
    const prepared = prepareWorkspace(e.suite, 'A-small', root, definition);
    assert.equal(prepared.startFingerprint, e.plan.trials[0].startFingerprint);
    const proof = probeScout(root); identities.push(proof.loadedPromptSha256);
    assert.equal(proof.loadedDefinitionSha256, e.plan.variants[variant].scoutSha256);
    assert.equal(proof.source, 'project'); assert.equal(proof.modelOverride, null); assert.equal(proof.effortOverride, null);
    assert(!fs.existsSync(path.join(root, 'criteria.json')));
  }
  assert.notEqual(identities[0], identities[1]);
  assert.throws(() => artifactPath(e.dir, '../outside'), /safe relative/);
  assert.throws(() => artifactPath(e.dir, '/tmp/outside'), /safe relative/);
});

test('CLI boundary recomputes fixed oracle and retains required synthetic 67/33.5 failure accounting', t => {
  const e = experiment(t);
  const attempts = [submission(e, 'A-small', 1, true, 10), submission(e, 'B-cross-contract', 1, false, 20, false), submission(e, 'B-cross-contract', 2, true, 30), submission(e, 'C-missing-contract', 1, false, 7)];
  const recordsFile = saveRecords(e, attempts.map(a => a.record));
  const report = reportEvaluation(e.planFile, recordsFile, true);
  assert.equal(report.valid, true);
  const result = report.variants.candidate;
  assert.equal(result.plannedTasks, 3); assert.equal(result.outcomes.accepted, 2);
  assert.equal(result.attempts, 4); assert.equal(result.retries, 1);
  assert.equal(result.firstSubmissionAcceptance.rate, 1 / 3);
  assert.equal(result.usage.totalTokens, 67); assert.equal(result.totalTokensPerAcceptedTrial, 33.5);
  assert.equal(report.dataKind, 'synthetic'); assert.equal(report.comparison.qualityOrUsageImprovementProven, false);
  assert.equal(result.trials[1].firstSubmissionOutcome, 'rejected');
  assert.throws(() => verifyAttempt(e.planFile, 'A-small', 'repeat-1', 'candidate', 1, attempts[0].workspaceRef, attempts[0].reviewRef), /overwrite/);
  // A worker self-report and a command string cannot alter judgments or execute.
  const marker = path.join(e.dir, 'MUST_NOT_EXIST');
  const records = attempts.map(a => ({ ...a.record, command: `touch ${marker}`, accepted: true }));
  const cli = spawnSync(process.execPath, [path.join(REPO, 'scripts/scout-evaluation.mjs'), 'report', e.planFile, saveRecords(e, records), '--dry-run'], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(cli.status, 0, cli.stderr); assert(!fs.existsSync(marker));
  assert.equal(JSON.parse(cli.stdout).variants.candidate.outcomes.rejected, 1);
  t.diagnostic('SYNTHETIC ONLY: tasks=3 accepted=2 attempts=4 retries=1 first=1/3 usage=67 perAccepted=33.5');
});

test('frozen first submission survives worker edits; tampered evidence fails re-verification', t => {
  const e = experiment(t), a = submission(e, 'A-small', 1, true, 10);
  const records = saveRecords(e, [a.record]);
  fs.writeFileSync(path.join(a.workspace, 'handoff.md'), 'worker later retry changes');
  assert.equal(reportEvaluation(e.planFile, records).valid, true);
  const receipt = JSON.parse(fs.readFileSync(path.join(e.dir, a.receiptRef)));
  fs.writeFileSync(path.join(e.dir, receipt.workspaceRef, 'src/label.js'), 'changed source');
  const report = reportEvaluation(e.planFile, records);
  assert.equal(report.valid, false); assert.equal(report.variants.candidate.outcomes.accepted, 0);
});

test('criteria cannot be satisfied by self-review, absent evidence or forbidden source changes', t => {
  const e = experiment(t), a = submission(e, 'A-small', 1, true, 10);
  const missing = structuredClone(a.review); delete missing.checks;
  assert.throws(() => judgeSubmission(e.suite, 'A-small', a.workspace, missing), /rubric/);
  const fake = structuredClone(a.review); fake.author = 'candidate';
  assert.throws(() => judgeSubmission(e.suite, 'A-small', a.workspace, fake), /evaluator/);
  fs.writeFileSync(path.join(a.workspace, 'src/label.js'), 'worker source modification');
  const changed = { ...a.review, candidateFingerprint: snapshotWorkspace(a.workspace).fingerprint };
  const result = judgeSubmission(e.suite, 'A-small', a.workspace, changed);
  assert.equal(result.outcome, 'rejected'); assert.equal(result.scopeViolation, true);
});

test('missing contract overclaim is rejected regardless of handoff heading or candidate accepted flag', t => {
  const e = experiment(t), a = submission(e, 'C-missing-contract', 1, true, 7);
  const overclaim = { ...a.review, accepted: true, sufficiency: { ...a.review.sufficiency, value: 'sufficient_for_requested_scope' } };
  const judgment = judgeSubmission(e.suite, 'C-missing-contract', a.workspace, overclaim);
  assert.equal(judgment.outcome, 'rejected');
  assert(!fs.readFileSync(path.join(a.workspace, 'handoff.md'), 'utf8').includes('Evidence Sufficiency'));
});

test('environment outcomes and missing usage remain visible; changed plan cannot be silently compared', t => {
  const e = experiment(t), a = submission(e, 'A-small', 1, false, 10, true, 'candidate', 'environment_error');
  a.record.usage = null; a.record.usageCompleteness = 'unavailable'; a.record.durationMs = null;
  const report = reportEvaluation(e.planFile, saveRecords(e, [a.record]));
  assert.equal(report.valid, true); assert.equal(report.variants.candidate.outcomes.environment_error, 1);
  assert.equal(report.variants.candidate.usage.totalTokens, null);
  fs.writeFileSync(e.planFile, JSON.stringify({ ...e.plan, settings: { ...e.plan.settings, parallelism: 4 } }));
  assert.throws(() => loadPlan(e.planFile), /Plan changed/);
});

test('complete usage cannot silently omit measured rows or reuse another attempt artifact', t => {
  const e = experiment(t), a = submission(e, 'A-small', 1, true, 10);
  const usagePath = path.join(e.dir, a.record.usage[0].evidenceRef);
  const usage = JSON.parse(fs.readFileSync(usagePath)); usage.rows.push({ ...usage.rows[0], model: 'other-model', totalTokens: 5 });
  fs.writeFileSync(usagePath, JSON.stringify(usage));
  const report = reportEvaluation(e.planFile, saveRecords(e, [a.record]));
  assert.equal(report.valid, false);
});

test('omitting a verified failure invalidates completeness and never turns its usage into zero', t => {
  const e = experiment(t);
  const attempts = [submission(e, 'A-small', 1, true, 10), submission(e, 'B-cross-contract', 1, false, 20, false), submission(e, 'B-cross-contract', 2, true, 30), submission(e, 'C-missing-contract', 1, false, 7)];
  const report = reportEvaluation(e.planFile, saveRecords(e, attempts.slice(0, 3).map(a => a.record)), true);
  assert.equal(report.valid, false);
  assert(report.diagnostics.some(d => d.code === 'omitted-verified-attempt' && d.path === attempts[3].receiptRef));
  const result = report.variants.candidate;
  assert.equal(result.omittedVerifiedAttempts, 1);
  assert.equal(result.usage.totalTokens, null);
  assert.equal(result.usage.observed.totalTokens, 60);
  assert.equal(result.usage.unknownAttempts, 1);
  assert.equal(result.totalTokensPerAcceptedTrial, null);
  const restored = reportEvaluation(e.planFile, saveRecords(e, attempts.map(a => a.record)));
  assert.equal(restored.valid, true);
  assert.equal(restored.variants.candidate.usage.totalTokens, 67);
});

test('partial usage is a multiset subset of evidence, not repeated copies of one measured row', t => {
  const e = experiment(t), a = submission(e, 'A-small', 1, true, 10);
  a.record.usageCompleteness = 'partial';
  a.record.usage.push({ ...a.record.usage[0] });
  const repeated = reportEvaluation(e.planFile, saveRecords(e, [a.record]));
  assert.equal(repeated.valid, false);
  assert(repeated.diagnostics.some(d => d.code === 'artifact-verification'));
  a.record.usage.pop();
  const subset = reportEvaluation(e.planFile, saveRecords(e, [a.record]));
  assert.equal(subset.valid, true);
  assert.equal(subset.variants.candidate.usage.totalTokens, null);
  assert.equal(subset.variants.candidate.usage.observed.totalTokens, 10);
});

test('verification receipts cannot be relabeled across repeat or submission identities', t => {
  const e = experiment(t), a = submission(e, 'A-small', 1, true, 10);
  for (const mutate of [r => { r.trialId = 'repeat-2'; }, r => { r.attemptIndex = 2; }, r => { r.variant = 'baseline'; }]) {
    const record = structuredClone(a.record); mutate(record);
    const report = reportEvaluation(e.planFile, saveRecords(e, [record]));
    assert.equal(report.valid, false);
    assert(report.diagnostics.some(d => d.code === 'artifact-verification'));
  }
  assert.throws(() => verifyAttempt(e.planFile, 'A-small', 'repeat-1', 'candidate', 2, a.workspaceRef, a.reviewRef), /identity mismatch/);
});

test('observed records require matching launch evidence, not merely a successful loader probe', t => {
  const e = experiment(t, false), a = submission(e, 'A-small', 1, true, 10);
  const records = saveRecords(e, [a.record]);
  assert.equal(reportEvaluation(e.planFile, records).valid, false);
  const runEvidenceRef = 'evidence/observed-launch.json';
  const launch = {
    kind: 'operator-observed-gsd-launch', evaluationId: a.record.evaluationId, taskId: a.record.taskId,
    trialId: a.record.trialId, variant: a.record.variant, attemptIndex: a.record.attemptIndex,
    loadedPromptSha256: a.record.scout.loadedPromptSha256, settingsFingerprint: a.record.settingsFingerprint,
    gsdRunId: 'SYNTHETIC_TEST_OF_OBSERVED_SCHEMA_NOT_A_MODEL_RUN',
  };
  a.record.scout.runEvidenceRef = runEvidenceRef;
  fs.writeFileSync(path.join(e.dir, runEvidenceRef), JSON.stringify({ ...launch, attemptIndex: 2 }));
  assert.equal(reportEvaluation(e.planFile, saveRecords(e, [a.record])).valid, false);
  fs.writeFileSync(path.join(e.dir, runEvidenceRef), JSON.stringify(launch));
  assert.equal(reportEvaluation(e.planFile, saveRecords(e, [a.record])).valid, true);
});

test('artifact and parent symlinks cannot redirect verification outside the experiment', t => {
  const e = experiment(t);
  const outside = path.dirname(e.dir);
  fs.writeFileSync(path.join(outside, 'outside.json'), '{}');
  fs.symlinkSync(path.join(outside, 'outside.json'), path.join(e.dir, 'file-link'));
  fs.symlinkSync(outside, path.join(e.dir, 'parent-link'), 'dir');
  assert.throws(() => artifactPath(e.dir, 'file-link'), /Symlink/);
  assert.throws(() => artifactPath(e.dir, 'parent-link/outside.json'), /Symlink/);
});
