// Offline, fixed-fixture verification. Never evaluates candidate code or commands.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fingerprint } from './scout-evaluation-records.mjs';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE_DIR = path.join(REPO, 'tests/scout-eval');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
export function readBounded(filename, maximum = 2 * 1024 * 1024) {
  const before = fs.lstatSync(filename);
  requireThat(before.isFile() && !before.isSymbolicLink() && before.size <= maximum, 'Expected a bounded regular artifact file');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    requireThat(stat.ino === before.ino && stat.dev === before.dev && stat.size <= maximum, 'Artifact changed during open');
    const buffer = Buffer.alloc(stat.size + 1); let count = 0;
    while (count < buffer.length) { const n = fs.readSync(fd, buffer, count, buffer.length - count, count); if (!n) break; count += n; }
    requireThat(count === stat.size, 'Artifact changed while reading');
    return buffer.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
export const readJson = filename => JSON.parse(readBounded(filename).toString('utf8'));
export function artifactPath(root, relative, { mustExist = true } = {}) {
  requireThat(typeof relative === 'string' && relative.length > 0 && relative.length <= 1024 && !path.isAbsolute(relative)
    && !relative.split(/[\\/]/).some(s => !s || s === '.' || s === '..') && !/[\x00-\x1f\\]/.test(relative), 'Artifact reference must be a safe relative path');
  const base = fs.realpathSync(root), result = path.join(base, relative);
  let current = base;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current)) requireThat(!fs.lstatSync(current).isSymbolicLink(), 'Symlink artifact references are not supported');
    else requireThat(!mustExist, 'Artifact reference is missing');
  }
  return result;
}
export function loadSuite({ allowUnsealed = false } = {}) {
  const fixturesRaw = readBounded(path.join(FIXTURE_DIR, 'fixtures.json'));
  const criteriaRaw = readBounded(path.join(FIXTURE_DIR, 'criteria.json'));
  const fixtures = JSON.parse(fixturesRaw), criteria = JSON.parse(criteriaRaw);
  requireThat(fixtures.schemaVersion === 'gsd.scout-fixtures/v1' && criteria.schemaVersion === 'gsd.scout-criteria/v1', 'Unsupported fixture/criteria schema');
  requireThat(fixtures.tasks.length === 3 && new Set(fixtures.tasks.map(t => t.id)).size === 3, 'Expected the three distinct pilot fixtures');
  for (const task of fixtures.tasks) {
    requireThat(task.request && task.environment && JSON.stringify(task.allowedChanges) === '["handoff.md"]', 'Fixture request/environment/scope missing');
    requireThat(criteria.tasks[task.id]?.checks.length && criteria.tasks[task.id]?.evidencePaths.every(p => p in task.files), 'Fixed criteria do not match fixture files');
    requireThat(Object.keys(task.files).every(p => /^[A-Za-z0-9._/-]+$/.test(p) && !p.includes('..') && !p.startsWith('/') && !p.startsWith('.')), 'Unsafe fixture path');
  }
  const identity = {
    fixtureVersion: fixtures.version, criteriaVersion: criteria.version,
    fixtureHash: sha256(fixturesRaw),
    criteriaHash: fingerprint({ criteria: sha256(criteriaRaw), verifier: sha256(readBounded(fileURLToPath(import.meta.url))), probe: sha256(readBounded(path.join(REPO, 'scripts/scout-evaluation-probe.mjs'))), records: sha256(readBounded(path.join(REPO, 'scripts/lib/scout-evaluation-records.mjs'))), cli: sha256(readBounded(path.join(REPO, 'scripts/scout-evaluation.mjs'))) }),
    baselineSha256: sha256(readBounded(path.join(FIXTURE_DIR, 'baseline-scout.md'))),
  };
  if (!allowUnsealed) requireThat(JSON.stringify(readJson(path.join(FIXTURE_DIR, 'lock.json'))) === JSON.stringify(identity), 'Fixture/oracle lock mismatch; publish a new evaluation version before changing criteria');
  return { fixtures, criteria, identity };
}
export function taskFixture(suite, id) {
  const task = suite.fixtures.tasks.find(t => t.id === id);
  requireThat(task, 'Unknown fixture task'); return task;
}
export function snapshotWorkspace(root) {
  const files = {}; let count = 0, bytes = 0;
  const base = fs.realpathSync(root);
  function walk(relative = '', depth = 0) {
    requireThat(depth <= 16, 'Workspace depth limit exceeded');
    for (const entry of fs.readdirSync(path.join(base, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!relative && ['.git', '.gsd'].includes(entry.name)) continue; // GSD-owned runtime, never copied as evaluation authority.
      requireThat(++count <= 200, 'Workspace entry limit exceeded');
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      requireThat(!entry.isSymbolicLink(), 'Workspace symlinks are not supported by these fixtures');
      if (entry.isDirectory()) walk(key, depth + 1);
      else {
        const buffer = readBounded(path.join(base, key), 256 * 1024); bytes += buffer.length;
        requireThat(bytes <= 1024 * 1024, 'Workspace byte limit exceeded');
        files[key] = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      }
    }
  }
  walk();
  return { files, fingerprint: fingerprint(files) };
}
export function prepareWorkspace(suite, taskId, directory, scoutDefinition) {
  requireThat(!fs.existsSync(directory), 'Refusing to overwrite an existing workspace');
  const task = taskFixture(suite, taskId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const [relative, text] of Object.entries(task.files)) {
    const file = path.join(directory, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, { flag: 'wx' });
  }
  fs.mkdirSync(path.join(directory, '.gsd/agents'), { recursive: true });
  fs.writeFileSync(path.join(directory, '.gsd/agents/scout.md'), scoutDefinition, { flag: 'wx' });
  return { taskId, startFingerprint: fingerprint(task.files), request: task.request, environment: task.environment };
}

/** Fixed mechanical criteria + separately authored evaluator rubric. This does
 * not infer semantic correctness from an agent's own status/accepted fields. */
export function judgeSubmission(suite, taskId, workspace, review) {
  const task = taskFixture(suite, taskId), criteria = suite.criteria.tasks[taskId];
  const snapshot = snapshotWorkspace(workspace);
  const handoff = snapshot.files['handoff.md'] ?? '';
  const reasons = [];
  const changed = new Set([...Object.keys(task.files), ...Object.keys(snapshot.files)].filter(p => task.files[p] !== snapshot.files[p]));
  const scopeViolation = [...changed].some(p => !task.allowedChanges.includes(p));
  const expected = suite.identity;
  requireThat(review?.schemaVersion === 'gsd.scout-review/v1' && review.author === 'evaluator' && /^[\w.-]{1,100}$/.test(review.reviewerId ?? ''), 'A separate evaluator review is required');
  requireThat(review.taskId === taskId && review.fixtureHash === expected.fixtureHash && review.criteriaHash === expected.criteriaHash, 'Review fixture/criteria mismatch');
  requireThat(review.candidateFingerprint === snapshot.fingerprint && review.handoffSha256 === sha256(handoff), 'Review does not bind the frozen submission');
  if (scopeViolation) reasons.push('scope-violation');
  const condition = review.condition ?? 'submission';
  requireThat(['submission', 'environment_error', 'timeout', 'incomplete'].includes(condition), 'Unsupported evaluator condition');
  if (condition !== 'submission') {
    requireThat(typeof review.conditionReason === 'string' && review.conditionReason.trim().length > 0, 'Non-submission outcome requires an evaluator explanation');
    return { outcome: scopeViolation ? 'rejected' : condition, scopeViolation, candidateFingerprint: snapshot.fingerprint, handoffSha256: sha256(handoff), reasons: [...reasons, 'evaluator-attested-condition'] };
  }
  if (!handoff.trim()) reasons.push('missing-handoff');
  requireThat(Array.isArray(review.citations) && review.citations.length <= 50, 'Evaluator citations are required');
  const cited = new Set();
  for (const citation of review.citations) {
    requireThat(typeof citation.path === 'string' && citation.path in task.files, 'Citation must identify a fixture source file');
    const lines = task.files[citation.path].split('\n');
    requireThat(Number.isSafeInteger(citation.startLine) && Number.isSafeInteger(citation.endLine) && citation.startLine >= 1 && citation.endLine >= citation.startLine && citation.endLine <= lines.length, 'Invalid citation line range');
    requireThat(citation.sourceQuote === lines.slice(citation.startLine - 1, citation.endLine).join('\n'), 'Citation does not match the fixed source');
    requireThat(typeof citation.handoffQuote === 'string' && citation.handoffQuote.includes(citation.path) && handoff.includes(citation.handoffQuote), 'Citation must identify its file in the submitted handoff');
    requireThat(citation.handoffQuote.includes(String(citation.startLine)) && citation.handoffQuote.includes(String(citation.endLine)), 'Citation line range must appear in the handoff evidence');
    cited.add(citation.path);
  }
  if (!criteria.evidencePaths.every(p => cited.has(p))) reasons.push('missing-source-contract-evidence');
  for (const check of criteria.checks) {
    const observation = review.checks?.[check];
    requireThat(observation && typeof observation.pass === 'boolean' && typeof observation.evidence === 'string' && observation.evidence.trim(), 'Fixed rubric check/evidence missing');
    requireThat(handoff.includes(observation.evidence), 'Rubric evidence must quote the submitted handoff');
    if (!observation.pass) reasons.push(check);
  }
  requireThat(review.sufficiency && typeof review.sufficiency.evidence === 'string' && review.sufficiency.evidence.trim() && handoff.includes(review.sufficiency.evidence), 'Sufficiency needs evaluator evidence in the handoff');
  if (!criteria.acceptableSufficiency.includes(review.sufficiency.value)) reasons.push('insufficient-or-overclaimed-scope');
  requireThat(review.stopReason && ['enough-evidence', 'no-new-evidence', 'budget', 'unavailable'].includes(review.stopReason.value) && typeof review.stopReason.evidence === 'string' && review.stopReason.evidence.trim() && handoff.includes(review.stopReason.evidence), 'Stop reason requires evaluator evidence');
  return { outcome: reasons.length ? 'rejected' : 'accepted', scopeViolation, candidateFingerprint: snapshot.fingerprint, handoffSha256: sha256(handoff), reasons };
}
