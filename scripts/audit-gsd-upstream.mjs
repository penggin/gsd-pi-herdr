#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseLsRemote, latestStable } from './audit-pi-upstream.mjs';

const MANIFEST = new URL('./gsd-upstream.json', import.meta.url);
const COMMIT = /^[0-9a-f]{40}$/;

function validateManifest(manifest) {
  const baseline = manifest?.upstreamAudit;
  if (manifest?.repository !== 'https://github.com/open-gsd/gsd-pi.git'
      || !COMMIT.test(manifest?.forkBase?.commit ?? '')
      || !baseline || !/^v\d+\.\d+\.\d+$/.test(baseline.reviewedStableRef ?? '')
      || !COMMIT.test(baseline.reviewedStableCommit ?? '')
      || !COMMIT.test(baseline.reviewedMainCommit ?? '')
      || baseline.reviewedMainRef !== 'refs/heads/main'
      || !baseline.reviewedAt || !baseline.auditDocument) {
    throw new Error('Invalid scripts/gsd-upstream.json review metadata');
  }
  return baseline;
}

/** Read-only freshness comparison; review metadata never implies a full merge. */
export function buildGsdAuditReport(manifest, output) {
  const baseline = validateManifest(manifest);
  let refs;
  try { refs = parseLsRemote(output); }
  catch { throw new Error('Malformed GSD upstream refs; query output was not included'); }
  const stable = latestStable(refs);
  const main = refs.get(baseline.reviewedMainRef);
  if (!main) throw new Error('GSD upstream main was not advertised');
  const changes = [];
  if (stable.ref !== baseline.reviewedStableRef || stable.commit !== baseline.reviewedStableCommit) changes.push('stable-release-changed');
  if (main !== baseline.reviewedMainCommit) changes.push('main-changed');
  return {
    schemaVersion: 1, observedAt: new Date().toISOString(), repository: manifest.repository,
    forkBase: manifest.forkBase, baseline,
    observed: { stable, main: { ref: baseline.reviewedMainRef, commit: main } },
    current: changes.length === 0, changes,
  };
}

export function renderGsdAudit(report) {
  return [
    '# GSD Pi upstream review status', '',
    `- Repository: ${report.repository}`,
    `- Full-sync base: ${report.forkBase.version} (${report.forkBase.commit})`,
    `- Last reviewed: ${report.baseline.reviewedAt}`,
    `- Observed at: ${report.observedAt}`,
    `- Reviewed release: ${report.baseline.reviewedStableRef} (${report.baseline.reviewedStableCommit})`,
    `- Observed release: ${report.observed.stable.ref} (${report.observed.stable.commit})`,
    `- Reviewed main: ${report.baseline.reviewedMainCommit}`,
    `- Observed main: ${report.observed.main.commit}`,
    `- Status: ${report.current ? 'current' : 'review required'}`,
    `- Record: ${report.baseline.auditDocument}`, '',
    'Reviewed means classified for selective backports, not fully merged or installed.', '',
  ].join('\n');
}

export function runGsdAudit(argv, query = (repository) => {
  try {
    return execFileSync('git', ['ls-remote', '--heads', '--tags', repository], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    // Do not echo transport diagnostics that may contain private Git credentials.
    throw new Error('GSD upstream query failed; check network and Git access');
  }
}) {
  if (argv.some(arg => !['--markdown', '--no-fail', '--help'].includes(arg))) throw new Error('Unknown audit option');
  if (argv.includes('--help')) return { text: 'Usage: node scripts/audit-gsd-upstream.mjs [--markdown] [--no-fail]\nRead-only git ls-remote; exit 2 means another review is required.\n', exitCode: 0 };
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  validateManifest(manifest); // Reject another repository before issuing any query.
  const report = buildGsdAuditReport(manifest, query(manifest.repository));
  return { text: argv.includes('--markdown') ? renderGsdAudit(report) : JSON.stringify(report, null, 2) + '\n', exitCode: report.current || argv.includes('--no-fail') ? 0 : 2 };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = runGsdAudit(process.argv.slice(2));
    process.stdout.write(result.text);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`[audit-gsd-upstream] ${error.message}\n`);
    process.exitCode = 1;
  }
}
