import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildGsdAuditReport, renderGsdAudit, runGsdAudit } from '../audit-gsd-upstream.mjs';

const manifest = JSON.parse(readFileSync(new URL('../gsd-upstream.json', import.meta.url), 'utf8'));
const base = manifest.upstreamAudit;
const output = `${base.reviewedStableCommit}\trefs/tags/${base.reviewedStableRef}\n${base.reviewedMainCommit}\trefs/heads/main\n`;

test('tracks reviewed GSD refs independently from the older fork and Pi vendor baselines', () => {
  const report = buildGsdAuditReport(manifest, output);
  assert.equal(report.current, true);
  assert.equal(report.forkBase.version, '1.16.2');
  assert.equal(report.observed.stable.ref, 'v1.18.0');
  assert.match(renderGsdAudit(report), /not fully merged or installed/);
});
test('flags a new main commit without silently advancing review metadata', () => {
  const before = JSON.stringify(manifest);
  const report = buildGsdAuditReport(manifest, output.replace(base.reviewedMainCommit, 'a'.repeat(40)));
  assert.deepEqual(report.changes, ['main-changed']);
  assert.equal(report.current, false);
  assert.equal(JSON.stringify(manifest), before);
});
test('detects moved release tags and numerically newer stable releases, excluding previews', () => {
  assert.deepEqual(buildGsdAuditReport(manifest, output.replace(base.reviewedStableCommit, 'b'.repeat(40))).changes, ['stable-release-changed']);
  const report = buildGsdAuditReport(manifest, output + `${'c'.repeat(40)}\trefs/tags/v1.19.0\n${'d'.repeat(40)}\trefs/tags/v2.0.0-rc1\n`);
  assert.equal(report.observed.stable.ref, 'v1.19.0');
});
test('uses peeled annotated tags and refuses incomplete or malformed refs', () => {
  const rows = output.replace(base.reviewedStableCommit, 'e'.repeat(40)) + `${base.reviewedStableCommit}\trefs/tags/${base.reviewedStableRef}^{}\n`;
  assert.equal(buildGsdAuditReport(manifest, rows).current, true);
  assert.throws(() => buildGsdAuditReport(manifest, output.split('\n')[0]), /main was not advertised/);
  assert.throws(() => buildGsdAuditReport(manifest, 'bad ref'), /Malformed/);
  assert.throws(() => buildGsdAuditReport({ ...manifest, upstreamAudit: null }, output), /Invalid/);
});
test('CLI is a non-mutating comparison with explicit drift exit status', () => {
  const query = (repository) => { assert.equal(repository, manifest.repository); return output.replace(base.reviewedMainCommit, 'f'.repeat(40)); };
  assert.equal(runGsdAudit(['--markdown'], query).exitCode, 2);
  assert.equal(runGsdAudit(['--no-fail'], query).exitCode, 0);
  assert.equal(runGsdAudit(['--help'], () => { throw Error('must not query'); }).exitCode, 0);
  assert.throws(() => runGsdAudit(['--apply'], query), /Unknown/);
  assert.throws(() => runGsdAudit([], () => { throw Error('offline'); }), /offline/);
});

test('malformed transport output is diagnosed without echoing sensitive text', () => {
  assert.throws(() => runGsdAudit([], () => 'not-a-ref SENSITIVE_DIAGNOSTIC'), error => {
    assert.match(error.message, /Malformed GSD upstream refs/);
    assert.doesNotMatch(error.message, /SENSITIVE_DIAGNOSTIC/);
    return true;
  });
});

test('tracking document and immutable source metadata stay aligned', () => {
  const doc = readFileSync(new URL('../../' + base.auditDocument, import.meta.url), 'utf8');
  for (const value of [base.reviewedAt, base.reviewedStableRef, base.reviewedStableCommit, base.reviewedMainCommit, manifest.forkBase.commit]) assert(doc.includes(value));
  for (const patch of manifest.selectedBackports) {
    assert.match(patch.commit, /^[0-9a-f]{40}$/);
    assert(doc.includes(patch.commit), patch.commit);
  }
  const pi = JSON.parse(readFileSync(new URL('../pi-upstream.json', import.meta.url), 'utf8'));
  assert.notEqual(manifest.repository, pi.repository);
  assert.equal(pi.pinnedRef, 'v0.75.5');
});
