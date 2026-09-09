// Project/App: gsd-pi
// File Purpose: Regression tests for the context-mode gsd_exec sandbox.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getShellConfig } from '@gsd/pi-coding-agent';
import { EXEC_DEFAULTS, runExecSandbox, type ExecSandboxOptions } from '../exec-sandbox.ts';
import { buildExecOptions, executeGsdExec } from '../tools/exec-tool.ts';
import { isContextModeEnabled } from '../preferences-types.ts';
import { validatePreferences } from '../preferences-validation.ts';
import { executeExecSearch } from '../tools/exec-search-tool.ts';
import { redactExecLog } from '../exec-log-text.ts';

function freshBase(): string {
  return mkdtempSync(join(tmpdir(), 'gsd-exec-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function baseOpts(base: string, overrides: Partial<ExecSandboxOptions> = {}): ExecSandboxOptions {
  return {
    baseDir: base,
    clamp_timeout_ms: EXEC_DEFAULTS.clampTimeoutMs,
    default_timeout_ms: 10_000,
    stdout_cap_bytes: 1_024,
    stderr_cap_bytes: 1_024,
    digest_chars: 120,
    env_allowlist: EXEC_DEFAULTS.envAllowlist,
    ...overrides,
  };
}

test('failure evidence includes stderr even when stdout contains progress', async () => {
  const base = freshBase();
  try {
    const result = await runExecSandbox({ runtime: 'node', script: 'console.log("Starting build..."); console.error("src/player.ts:42: Type error: incompatible return type"); process.exitCode=1;' }, baseOpts(base, { digest_chars: 400 }));
    assert.equal(result.exit_code, 1);
    assert.match(result.digest, /src\/player\.ts:42: Type error/);
    assert.match(result.digest, /stderr/);
  } finally { cleanup(base); }
});

test('failure evidence selects middle stdout errors and includes both relevant streams', async () => {
  const base = freshBase();
  try {
    const result = await runExecSandbox({ runtime: 'node', script: 'console.log("begin\\nsrc/a.ts:9: failed check\\n"+"noise\\n".repeat(80)); console.error("src/b.ts:5: Error: secondary cause"); process.exitCode=2;' }, baseOpts(base, { digest_chars: 500 }));
    assert.match(result.digest, /src\/a\.ts:9: failed check/);
    assert.match(result.digest, /src\/b\.ts:5: Error/);
    assert.equal(result.exit_code, 2);
  } finally { cleanup(base); }
});

test('error words do not determine process success and all emitted evidence is redacted', async () => {
  const base = freshBase();
  const secret = 'sk-'+'S'.repeat(40);
  try {
    const result = await runExecSandbox({ runtime: 'node', purpose: `check ${secret}`, metadata: { expected: secret, nested: { text: 'password="SYNTHETIC_PASSWORD"' } }, script: `console.log(${JSON.stringify(`error count: 0\n${secret}`)});` }, baseOpts(base, { digest_chars: 400 }));
    assert.equal(result.exit_code, 0);
    for (const value of [result.digest, readFileSync(result.stdout_path, 'utf8'), readFileSync(result.meta_path, 'utf8')]) assert(!value.includes(secret));
    assert(!readFileSync(result.meta_path, 'utf8').includes('SYNTHETIC_PASSWORD'));
  } finally { cleanup(base); }
});

test('spawn failure uses the same redacted bounded evidence path', async () => {
  const base = freshBase();
  const secret = 'sk-' + 'X'.repeat(40);
  try {
    const result = await runExecSandbox({ runtime: 'node', script: 'unused' }, baseOpts(base, { env: { PATH: process.env.PATH, BAD_INPUT: secret + '\0' }, env_allowlist: ['BAD_INPUT'] }));
    assert.equal(result.exit_code, null);
    assert.equal(result.force_resolved, false);
    assert(!JSON.stringify(result).includes(secret));
    assert(!readFileSync(result.stderr_path, 'utf8').includes(secret));
    assert(result.digest.length <= 120);
  } finally { cleanup(base); }
});

test('saved prefix limits and split UTF-8 are honest in digest and retrieval', async () => {
  const base = freshBase();
  try {
    const result = await runExecSandbox({ runtime: 'node', script: 'process.stdout.write("가나다"+"noise".repeat(200)+"ERROR_OUTSIDE_CAPTURE");process.exitCode=1' }, baseOpts(base, { stdout_cap_bytes: 4, digest_chars: 200 }));
    const stored = readFileSync(result.stdout_path, 'utf8');
    assert.equal(result.stdout_bytes, 4);
    assert.equal(result.stdout_truncated, true);
    assert(stored.startsWith('가\n[truncated:'));
    assert(!stored.includes('\uFFFD'));
    assert(!result.digest.includes('ERROR_OUTSIDE_CAPTURE'));
    assert(!/whole|full.*tail/i.test(result.digest));
    const search = await executeExecSearch({ mode: 'search', exec_id: result.id, query: 'ERROR_OUTSIDE_CAPTURE' }, { baseDir: base });
    assert.equal(search.details.matches, 0);
    assert.equal(search.details.storage_truncated, true);
    assert.match(search.content[0].text, /scanned range/);
  } finally { cleanup(base); }
});

test('PEM redaction preserves persisted log coordinates and repeated BEGIN input is bounded', async () => {
  const base = freshBase();
  const pem = '-----BEGIN RSA PRIVATE KEY-----\r\nSYNTHETIC_PRIVATE_MATERIAL\r\n-----END RSA PRIVATE KEY-----\r\nsrc/a.ts:4: Error: cause\r\n';
  try {
    const result = await runExecSandbox({ runtime: 'node', script: `process.stderr.write(${JSON.stringify(pem)});process.exitCode=1` }, baseOpts(base, { digest_chars: 300 }));
    const stored = readFileSync(result.stderr_path, 'utf8');
    assert(!stored.includes('SYNTHETIC_PRIVATE_MATERIAL'));
    assert.equal(stored.split('\n')[3], 'src/a.ts:4: Error: cause\r');
    const read = await executeExecSearch({ mode: 'read', exec_id: result.id, stream: 'stderr', start_line: 4, line_count: 1 }, { baseDir: base });
    assert.equal((read.details.results as any[])[0].text, 'src/a.ts:4: Error: cause');
    const repeated = '-----BEGIN RSA PRIVATE KEY-----\n'.repeat(16000) + 'SYNTHETIC_PRIVATE_MATERIAL\n-----END RSA PRIVATE KEY-----';
    const redacted = redactExecLog(repeated);
    assert(!redacted.includes('SYNTHETIC_PRIVATE_MATERIAL'));
    assert.equal(redacted.split('\n').length, repeated.split('\n').length);
    assert.equal(redactExecLog(redacted), redacted);
  } finally { cleanup(base); }
});

test('runExecSandbox: captures stdout, persists artifacts, returns digest', async () => {
  const base = freshBase();
  try {
    const result = await runExecSandbox(
      { runtime: 'bash', script: 'echo hello world' },
      baseOpts(base),
    );
    assert.equal(result.exit_code, 0);
    assert.equal(result.timed_out, false);
    assert.ok(result.digest.includes('hello world'), `digest should contain stdout: ${result.digest}`);
    assert.ok(result.stdout_path.startsWith(join(base, '.gsd', 'exec')), 'stdout path under .gsd/exec');
    assert.equal(readFileSync(result.stdout_path, 'utf-8').trim(), 'hello world');
    const meta = JSON.parse(readFileSync(result.meta_path, 'utf-8')) as Record<string, unknown>;
    assert.equal(meta.runtime, 'bash');
    assert.equal(meta.exit_code, 0);
  } finally {
    cleanup(base);
  }
});

test('runExecSandbox: bash runtime uses resolved shell config', async () => {
  const base = freshBase();
  try {
    const { shell } = getShellConfig();
    const result = await runExecSandbox(
      { runtime: 'bash', script: 'printf "%s" "$0"' },
      baseOpts(base),
    );
    assert.equal(result.exit_code, 0);
    assert.equal(readFileSync(result.stdout_path, 'utf-8'), shell);
  } finally {
    cleanup(base);
  }
});

test('runExecSandbox: persists optional request metadata', async () => {
  const base = freshBase();
  try {
    const result = await runExecSandbox(
      {
        runtime: 'bash',
        script: 'echo metadata-ok',
        metadata: { kind: 'uat_exec', intent: 'uat-artifact-check' },
      },
      baseOpts(base),
    );
    const meta = JSON.parse(readFileSync(result.meta_path, 'utf-8')) as Record<string, unknown>;
    assert.deepEqual(meta.metadata, { kind: 'uat_exec', intent: 'uat-artifact-check' });
  } finally {
    cleanup(base);
  }
});

test('runExecSandbox: enforces stdout cap and marks truncation', async () => {
  const base = freshBase();
  try {
    const result = await runExecSandbox(
      // Emit far more than the cap so truncation triggers.
      { runtime: 'bash', script: 'head -c 8000 /dev/urandom | base64' },
      baseOpts(base, { stdout_cap_bytes: 256 }),
    );
    assert.equal(result.stdout_truncated, true, 'should mark stdout truncated');
    assert.ok(result.stdout_bytes <= 256, `stdout_bytes within cap (got ${result.stdout_bytes})`);
    const stdout = readFileSync(result.stdout_path, 'utf-8');
    assert.ok(stdout.endsWith('[truncated: stdout cap reached]\n'), 'truncation marker appended');
  } finally {
    cleanup(base);
  }
});

test('runExecSandbox: enforces timeout and surfaces timed_out', async () => {
  const base = freshBase();
  try {
    const started = Date.now();
    const result = await runExecSandbox(
      { runtime: 'bash', script: 'sleep 10' },
      baseOpts(base, { default_timeout_ms: 150, clamp_timeout_ms: 150 }),
    );
    const elapsed = Date.now() - started;
    assert.equal(result.timed_out, true);
    assert.ok(elapsed < 5_000, `should return well before 10s (took ${elapsed}ms)`);
  } finally {
    cleanup(base);
  }
});

test('runExecSandbox: forwards only allowlisted env vars', async () => {
  const base = freshBase();
  try {
    const result = await runExecSandbox(
      { runtime: 'bash', script: 'echo PATH=$PATH BLOCKED=$GSD_TEST_BLOCKED_VALUE' },
      baseOpts(base, {
        env_allowlist: [],
        env: { PATH: '/usr/bin:/bin', HOME: '/tmp', GSD_TEST_BLOCKED_VALUE: 'blocked-value' },
      }),
    );
    const stdout = readFileSync(result.stdout_path, 'utf-8');
    assert.ok(stdout.includes('PATH=/usr/bin:/bin'), 'PATH forwarded');
    assert.ok(!stdout.includes('blocked-value'), 'non-allowlisted var blocked');
  } finally {
    cleanup(base);
  }
});

test('runExecSandbox: node runtime executes JS', async () => {
  const base = freshBase();
  try {
    const result = await runExecSandbox(
      { runtime: 'node', script: 'console.log("node-ok:" + (1+2))' },
      baseOpts(base),
    );
    assert.equal(result.exit_code, 0);
    assert.ok(result.digest.includes('node-ok:3'));
  } finally {
    cleanup(base);
  }
});

test('runExecSandbox: node runtime forwards NODE_PATH for GSD-installed dependencies', async () => {
  const base = freshBase();
  try {
    const dependencyRoot = join(base, 'parent-node_modules');
    const packageDir = join(dependencyRoot, 'fake-gsd-dep');
    const worktree = join(base, 'project', '.gsd', 'worktrees', 'M003');
    mkdirSync(packageDir, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: 'fake-gsd-dep', version: '1.0.0', main: 'index.js' }),
    );
    writeFileSync(join(packageDir, 'index.js'), "module.exports = 'resolved-via-node-path';\n");

    const result = await runExecSandbox(
      { runtime: 'node', script: "console.log(require('fake-gsd-dep'))" },
      baseOpts(worktree, {
        env: {
          PATH: '/usr/bin:/bin',
          HOME: '/tmp',
          NODE_PATH: dependencyRoot,
        },
      }),
    );

    assert.equal(result.exit_code, 0, readFileSync(result.stderr_path, 'utf-8'));
    assert.ok(result.digest.includes('resolved-via-node-path'));
  } finally {
    cleanup(base);
  }
});

test('runExecSandbox: rewrites NUL redirects for bash on Windows', async () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const base = freshBase();
  try {
    const result = await runExecSandbox(
      { runtime: 'bash', script: 'echo should-not-create-file > NUL' },
      baseOpts(base),
    );
    assert.equal(result.exit_code, 0);
    assert.equal(existsSync(join(base, 'NUL')), false, 'must not materialize a literal NUL file');
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    cleanup(base);
  }
});

// ── exec-tool executor ────────────────────────────────────────────────────

test('executeGsdExec: runs by default when context_mode is unset', async () => {
  const base = freshBase();
  try {
    const result = await executeGsdExec(
      { runtime: 'bash', script: 'echo default-on-run' },
      { baseDir: base, preferences: {} },
    );
    assert.ok(!result.isError, 'should succeed with no preferences');
    assert.equal(result.details.operation, 'gsd_exec');
    assert.equal(result.details.exit_code, 0);
    assert.ok(result.content[0].text.includes('default-on-run'));
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: runs when preferences is null (fresh project)', async () => {
  const base = freshBase();
  try {
    const result = await executeGsdExec(
      { runtime: 'bash', script: 'echo null-prefs-run' },
      { baseDir: base, preferences: null },
    );
    assert.ok(!result.isError, 'null preferences should not disable');
    assert.ok(result.content[0].text.includes('null-prefs-run'));
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: blocked only when context_mode.enabled=false', async () => {
  const base = freshBase();
  try {
    const result = await executeGsdExec(
      { runtime: 'bash', script: 'echo should-not-run' },
      { baseDir: base, preferences: { context_mode: { enabled: false } } },
    );
    assert.equal(result.isError, true);
    assert.equal((result.details as { error?: string }).error, 'context_mode_disabled');
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: runs when enabled explicitly set to true', async () => {
  const base = freshBase();
  try {
    const result = await executeGsdExec(
      { runtime: 'bash', script: 'echo explicit-on' },
      { baseDir: base, preferences: { context_mode: { enabled: true } } },
    );
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes('explicit-on'));
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: forwards custom exec_env_allowlist from preferences', async () => {
  const base = freshBase();
  try {
    const result = await executeGsdExec(
      {
        runtime: 'bash',
        script: 'printf "allowed=%s blocked=%s\\n" "$GSD_ALLOWED" "$GSD_BLOCKED"',
      },
      {
        baseDir: base,
        preferences: {
          context_mode: {
            enabled: true,
            exec_env_allowlist: ['GSD_ALLOWED'],
          },
        },
        env: {
          PATH: '/usr/bin:/bin',
          HOME: '/tmp',
          GSD_ALLOWED: 'yes',
          GSD_BLOCKED: 'no',
        },
      },
    );
    assert.ok(!result.isError);
    assert.match(result.content[0].text, /allowed=yes blocked=/);
    assert.doesNotMatch(result.content[0].text, /blocked=no/);
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: enforces per-call timeout override end-to-end', async () => {
  const base = freshBase();
  try {
    const result = await executeGsdExec(
      { runtime: 'bash', script: 'sleep 2', timeout_ms: 1 },
      { baseDir: base, preferences: { context_mode: { enabled: true, exec_timeout_ms: 10_000 } } },
    );
    assert.equal(result.details.timed_out, true);
    assert.equal(result.isError, true);
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: defaults to bash and accepts command alias', async () => {
  const base = freshBase();
  try {
    const result = await executeGsdExec(
      { command: 'echo command-alias-defaults-to-bash' },
      { baseDir: base, preferences: { context_mode: { enabled: true } } },
    );
    assert.equal(result.isError, false);
    assert.equal(result.details.runtime, 'bash');
    assert.ok(result.content[0].text.includes('command-alias-defaults-to-bash'));
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: accepts common runtime aliases', async () => {
  const base = freshBase();
  try {
    const result = await executeGsdExec(
      { runtime: 'js', code: 'console.log("runtime-alias-node")' },
      { baseDir: base, preferences: { context_mode: { enabled: true } } },
    );
    assert.equal(result.isError, false);
    assert.equal(result.details.runtime, 'node');
    assert.ok(result.content[0].text.includes('runtime-alias-node'));
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: rejects empty script', async () => {
  const base = freshBase();
  try {
    const result = await executeGsdExec(
      { runtime: 'bash', script: '   ' },
      { baseDir: base, preferences: { context_mode: { enabled: true } } },
    );
    assert.equal(result.isError, true);
    assert.equal((result.details as { error?: string }).error, 'invalid_params');
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: rejects original-root scripts from milestone worktrees', async () => {
  const base = freshBase();
  try {
    const originalRoot = join(base, 'project');
    const worktree = join(originalRoot, '.gsd', 'worktrees', 'M004');
    mkdirSync(worktree, { recursive: true });

    const result = await executeGsdExec(
      { runtime: 'bash', script: `cd ${originalRoot} && node todo.js --help` },
      { baseDir: worktree, preferences: { context_mode: { enabled: true } } },
    );

    assert.equal(result.isError, true);
    assert.equal((result.details as { error?: string }).error, 'invalid_params');
    assert.match(
      (result.details as { detail?: string }).detail ?? '',
      /original project root/,
    );
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: rejects macOS /var alias of original root from milestone worktrees', async () => {
  const originalRoot = '/var/folders/example/project';
  const realpathedWorktree = '/private/var/folders/example/project/.gsd/worktrees/M004';

  const result = await executeGsdExec(
    { runtime: 'bash', script: `cd ${originalRoot} && node todo.js --help` },
    { baseDir: realpathedWorktree, preferences: { context_mode: { enabled: true } } },
  );

  assert.equal(result.isError, true);
  assert.equal((result.details as { error?: string }).error, 'invalid_params');
  assert.match(
    (result.details as { detail?: string }).detail ?? '',
    /original project root/,
  );
});

test('executeGsdExec: rejects original-root traversal after shell boolean operators', async () => {
  const base = freshBase();
  try {
    const originalRoot = join(base, 'project');
    const worktree = join(originalRoot, '.gsd', 'worktrees', 'M004');
    mkdirSync(worktree, { recursive: true });

    const scripts = [
      'echo hi && cd ../../.. && pwd',
      'true || cd ../../..',
    ];

    for (const script of scripts) {
      const result = await executeGsdExec(
        { runtime: 'bash', script },
        { baseDir: worktree, preferences: { context_mode: { enabled: true } } },
      );
      assert.equal(result.isError, true);
      assert.equal((result.details as { error?: string }).error, 'invalid_params');
      assert.match((result.details as { detail?: string }).detail ?? '', /original project root/);
    }
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: allows active worktree paths from milestone worktrees', async () => {
  const base = freshBase();
  try {
    const originalRoot = join(base, 'project');
    const worktree = join(originalRoot, '.gsd', 'worktrees', 'M004');
    mkdirSync(worktree, { recursive: true });

    const result = await executeGsdExec(
      { runtime: 'bash', script: `cd ${worktree} && pwd` },
      { baseDir: worktree, preferences: { context_mode: { enabled: true } } },
    );

    assert.equal(result.isError, false);
    assert.equal(result.details.exit_code, 0);
  } finally {
    cleanup(base);
  }
});

test('executeGsdExec: rejects relative traversal to original root from milestone worktree', async () => {
  const base = freshBase();
  try {
    const originalRoot = join(base, 'project');
    const worktree = join(originalRoot, '.gsd', 'worktrees', 'M004');
    mkdirSync(worktree, { recursive: true });

    const scripts = [
      'cd ../../.. && pwd',
      "node -e \"process.chdir('../../..'); console.log(process.cwd())\"",
      "node -e \"const p = require('node:path'); process.chdir(p.join(process.cwd(), '../../..')); console.log(process.cwd())\"",
    ];

    for (const script of scripts) {
      const result = await executeGsdExec(
        { runtime: 'bash', script },
        { baseDir: worktree, preferences: { context_mode: { enabled: true } } },
      );
      assert.equal(result.isError, true, `expected script to be rejected: ${script}`);
      assert.equal((result.details as { error?: string }).error, 'invalid_params');
      assert.match((result.details as { detail?: string }).detail ?? '', /original project root/);
    }
  } finally {
    cleanup(base);
  }
});

test('validatePreferences: rejects invalid context_mode preference values', () => {
  const result = validatePreferences({
    context_mode: {
      enabled: 'false',
      exec_timeout_ms: 999,
      exec_stdout_cap_bytes: 1,
      exec_digest_chars: -1,
      exec_env_allowlist: ['GOOD_NAME', 'bad-name'],
    },
  } as any);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.includes('context_mode.enabled must be a boolean'));
  assert.ok(result.errors.includes('context_mode.exec_timeout_ms must be a number between 1000 and 600000'));
  assert.ok(result.errors.includes('context_mode.exec_stdout_cap_bytes must be a number between 4096 and 16777216'));
  assert.ok(result.errors.includes('context_mode.exec_digest_chars must be a number between 0 and 4000'));
  assert.ok(result.errors.includes('context_mode.exec_env_allowlist must be an array of valid env var names'));
});

test('isContextModeEnabled: defaults to true; only explicit false disables', () => {
  assert.equal(isContextModeEnabled(undefined), true, 'undefined prefs → on');
  assert.equal(isContextModeEnabled(null), true, 'null prefs → on');
  assert.equal(isContextModeEnabled({}), true, 'empty prefs → on');
  assert.equal(isContextModeEnabled({ context_mode: {} }), true, 'empty block → on');
  assert.equal(isContextModeEnabled({ context_mode: { enabled: true } }), true);
  assert.equal(isContextModeEnabled({ context_mode: { enabled: false } }), false);
});

test('buildExecOptions: defaults to verification timeout and honors exec override', () => {
  const defaulted = buildExecOptions('/tmp/base', null);
  assert.equal(defaulted.default_timeout_ms, 120_000);

  const inherited = buildExecOptions('/tmp/base', {
    verification_timeout_ms: 345_678,
    context_mode: { enabled: true },
  });
  assert.equal(inherited.default_timeout_ms, 345_678);

  const overridden = buildExecOptions('/tmp/base', {
    verification_timeout_ms: 345_678,
    context_mode: { enabled: true, exec_timeout_ms: 234_567 },
  });
  assert.equal(overridden.default_timeout_ms, 234_567);
});

test('buildExecOptions: clamps out-of-range values to safe defaults', () => {
  const opts = buildExecOptions('/tmp/base', {
    context_mode: {
      enabled: true,
      exec_timeout_ms: 999_999_999,
      exec_stdout_cap_bytes: 1,
      exec_digest_chars: -20,
    },
  });
  assert.equal(opts.default_timeout_ms, EXEC_DEFAULTS.clampTimeoutMs, 'timeout clamped to upper bound');
  assert.equal(opts.stdout_cap_bytes, 4_096, 'stdout cap clamped to floor');
  assert.equal(opts.digest_chars, 0, 'digest chars clamped to floor');
});
