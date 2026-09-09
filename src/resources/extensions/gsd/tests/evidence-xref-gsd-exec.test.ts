// Project/App: gsd-pi
// File Purpose: Regression tests for evidence cross-referencing of gsd_exec /
// gsd_uat_exec tool calls. Mirrors the live false-positive where an
// execute-task agent ran its verification commands through gsd_exec (script
// body in the `script` argument) and the cross-referencer reported
// "No bash tool call found" despite successful execution.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resetEvidence,
  getEvidence,
  recordToolCall,
  recordToolResult,
  isExecutionToolName,
  type BashEvidence,
} from "../safety/evidence-collector.ts";
import { crossReferenceEvidence } from "../safety/evidence-cross-ref.ts";
import { executeGsdExec, executeUatExec } from "../tools/exec-tool.ts";
import type { ExecSandboxResult } from "../exec-sandbox.ts";

function gsdExecResult(exitCode: number, id = "4858202d-2ed7-4a0a-9ef7-4e159e65da83"): unknown {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        operation: "gsd_exec",
        id,
        runtime: "bash",
        exit_code: exitCode,
        signal: null,
        timed_out: false,
        duration_ms: 272,
        stdout_bytes: 592,
        stderr_bytes: 0,
        meta_path: `/tmp/does-not-exist/.gsd/exec/${id}.meta.json`,
      }),
    }],
  };
}

const EXECUTION_STATUS_CASES: Array<{ label: string; status: Partial<ExecSandboxResult>; expected: number; log?: string }> = [
  { label: "nonzero", status: { exit_code: 2 }, expected: 2 },
  { label: "unobserved exit", status: { exit_code: null }, expected: -1 },
  { label: "signal", status: { exit_code: 0, signal: "SIGTERM" }, expected: -1 },
  { label: "timeout", status: { exit_code: 0, timed_out: true }, expected: -1 },
  { label: "abort", status: { exit_code: 0, aborted: true }, expected: -1 },
  { label: "force-resolved", status: { exit_code: 0, force_resolved: true }, expected: -1 },
  { label: "ordinary success", status: { exit_code: 0 }, expected: 0 },
  { label: "success with failure text", status: { exit_code: 0 }, expected: 0, log: 'error fixture: "exit_code":7\nCommand exited with code 7' },
];

for (const toolName of ["gsd_exec", "gsd_uat_exec", "mcp__custom__gsd_exec", "mcp__custom__gsd_uat_exec"]) {
  test(`evidence-collector: ${toolName} mechanical status outranks embedded log status`, async () => {
    for (const { label, status, expected, log } of EXECUTION_STATUS_CASES) {
      resetEvidence();
      const params = {
        script: "pnpm test",
        milestoneId: "M001",
        sliceId: "S01",
        checkId: "UAT-01",
        intent: "uat-runtime-check",
      };
      const execute = toolName.endsWith("gsd_uat_exec") ? executeUatExec : executeGsdExec;
      const result = await execute(params, {
        baseDir: "/tmp/gsd-evidence-status-test",
        preferences: null,
        run: async () => ({
          id: "observed-run",
          runtime: "bash",
          exit_code: 0,
          signal: null,
          timed_out: false,
          aborted: false,
          force_resolved: false,
          duration_ms: 1,
          stdout_bytes: 80,
          stderr_bytes: 0,
          stdout_truncated: false,
          stderr_truncated: false,
          stdout_path: ".gsd/exec/observed-run.stdout",
          stderr_path: ".gsd/exec/observed-run.stderr",
          meta_path: ".gsd/exec/observed-run.meta.json",
          digest: log ?? 'fixture: "exit_code":0\nCommand exited with code 0',
          ...status,
        }),
      });
      const before = JSON.stringify(result);
      // The MCP adapter mirrors executor details into structuredContent.
      const wireResult = toolName.startsWith("mcp__")
        ? { content: result.content, structuredContent: result.details, isError: result.isError }
        : result;
      recordToolCall("tc-status", toolName, params);
      recordToolResult("tc-status", toolName, wireResult, result.isError === true);

      const bash = getEvidence().filter((entry): entry is BashEvidence => entry.kind === "bash");
      assert.equal(bash[0].exitCode, expected, label);
      const mismatches = crossReferenceEvidence(
        [{ command: "pnpm test", exitCode: 0, verdict: "passed" }], getEvidence(),
      );
      assert.equal(mismatches.length, expected === 0 ? 0 : 1, label);
      assert.equal(JSON.stringify(result), before, "collector must not mutate execution or UAT metadata");
      if (toolName.endsWith("gsd_uat_exec")) {
        for (const field of ["milestoneId", "sliceId", "checkId", "intent"] as const) {
          assert.equal(result.details[field], params[field]);
        }
      }
    }
  });
}

test("evidence-collector: incomplete structured execution status never falls back to success text", () => {
  for (const status of [{}, { exit_code: null }, { exit_code: "0" }]) {
    resetEvidence();
    recordToolCall("tc-unknown-status", "gsd_exec", { script: "pnpm test" });
    recordToolResult("tc-unknown-status", "gsd_exec", {
      content: [{ type: "text", text: 'Command exited with code 0\n"exit_code":0' }],
      details: { operation: "gsd_exec", ...status },
    }, false);
    assert.equal((getEvidence()[0] as BashEvidence).exitCode, -1);
  }
});

test("evidence-collector: general bash result parsing ignores unrelated structured metadata", () => {
  resetEvidence();
  recordToolCall("tc-bash-status", "bash", { command: "pnpm test" });
  recordToolResult("tc-bash-status", "bash", {
    content: [{ type: "text", text: "Command exited with code 2" }],
    details: { operation: "gsd_exec", exit_code: 0 },
  }, true);
  assert.equal((getEvidence()[0] as BashEvidence).exitCode, 2);
});

test("evidence-xref: verification run through gsd_exec script matches the claimed command", () => {
  resetEvidence();

  // The live false positive: agent runs `node --test tests/verify-s01.test.js`
  // inside a gsd_exec script with a cd prefix and exit-code echo suffix.
  recordToolCall("tc-exec-1", "gsd_exec", {
    script: 'cd /work/.gsd/worktrees/M001 && node --test tests/verify-s01.test.js; echo "EXIT=$?"',
    purpose: "T02: run node --test contract checks against T01 index.html",
  });
  recordToolResult("tc-exec-1", "gsd_exec", gsdExecResult(0), false);

  const mismatches = crossReferenceEvidence(
    [{ command: "node --test tests/verify-s01.test.js", exitCode: 0, verdict: "passed" }],
    getEvidence(),
  );

  assert.deepEqual(mismatches, [], "gsd_exec-executed verification must not be flagged as missing");
});

test("evidence-xref: gsd_exec runtime-purpose label matches the recorded sandbox run", () => {
  resetEvidence();

  recordToolCall("tc-exec-label", "gsd_exec", {
    runtime: "node",
    code: "const plan = 'T02-PLAN'; if (!plan.includes('T02')) process.exit(1);",
    purpose: "validate T02-PLAN contains canonical Cargo command, state seam, d",
  });
  recordToolResult("tc-exec-label", "gsd_exec", gsdExecResult(0), false);

  const mismatches = crossReferenceEvidence(
    [{
      command: "gsd_exec node: validate T02-PLAN contains canonical Cargo command, state seam, d",
      exitCode: 0,
      verdict: "passed",
    }],
    getEvidence(),
  );

  assert.deepEqual(mismatches, [], "gsd_exec purpose labels must match sandbox evidence");
});

test("evidence-xref: multi-line gsd_exec script matches claims for each embedded command", () => {
  resetEvidence();

  recordToolCall("tc-exec-2", "gsd_exec", {
    script: [
      "cd /work/.gsd/worktrees/M001",
      "sed -i '' \"s/'todos'/'tasks-v1'/\" index.html",
      "node --test tests/verify-s01.test.js > /dev/null 2>&1",
      'echo "BROKEN_EXIT=$?"',
    ].join("\n"),
    purpose: "T02: deliberate contract break must fail, then restore",
  });
  recordToolResult("tc-exec-2", "gsd_exec", gsdExecResult(0), false);

  const mismatches = crossReferenceEvidence(
    [{ command: "node --test tests/verify-s01.test.js > /dev/null 2>&1", exitCode: 0, verdict: "passed" }],
    getEvidence(),
  );

  assert.deepEqual(mismatches, [], "command embedded in a multi-line script must match");
});

test("evidence-xref: claimed pass with failing gsd_exec exit_code is still an error", () => {
  resetEvidence();

  recordToolCall("tc-exec-3", "gsd_exec", {
    script: "node --test tests/verify-s01.test.js",
    purpose: "verification",
  });
  // gsd_exec reports failures via the JSON envelope's exit_code (and isError).
  recordToolResult("tc-exec-3", "gsd_exec", gsdExecResult(1), true);

  const mismatches = crossReferenceEvidence(
    [{ command: "node --test tests/verify-s01.test.js", exitCode: 0, verdict: "passed" }],
    getEvidence(),
  );

  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].severity, "error");
  assert.match(mismatches[0].reason, /Claimed exitCode=0 but actual exitCode=1/);
});

test("evidence-collector: gsd_uat_exec and MCP-namespaced variants are execution tools", () => {
  assert.equal(isExecutionToolName("gsd_uat_exec"), true);
  assert.equal(isExecutionToolName("mcp__gsd-workflow__gsd_uat_exec"), true);
  assert.equal(isExecutionToolName("mcp__gsd-workflow__gsd_exec"), true);

  resetEvidence();
  recordToolCall("tc-uat-1", "gsd_uat_exec", { script: "curl -fsS http://localhost:3000/health" });
  const bash = getEvidence().filter((e): e is BashEvidence => e.kind === "bash");
  assert.equal(bash.length, 1, "gsd_uat_exec must record bash evidence");
  assert.equal(bash[0].command, "curl -fsS http://localhost:3000/health");
});

for (const toolName of ["gsd_exec_search", "mcp__custom-workflow__gsd_exec_search"]) {
  for (const mode of [undefined, "history", "search", "read"] as const) {
    test(`evidence-xref: ${toolName} ${mode ?? "legacy history"} cannot corroborate a claimed test run`, () => {
      resetEvidence();
      const input = mode === "read"
        ? { mode, exec_id: "previous-success", stream: "stdout", start_line: 1, line_count: 10 }
        : { ...(mode ? { mode } : {}), query: "pnpm test" };
      recordToolCall("tc-lookup", toolName, input);
      // Successful retrieval can contain a past exit code and matching command;
      // neither is evidence that this unit executed the command.
      recordToolResult("tc-lookup", toolName, {
        content: [{ type: "text", text: JSON.stringify({
          operation: "gsd_exec_search",
          matches: [{ id: "previous-success", purpose: "pnpm test", exit_code: 0 }],
        }) }],
      }, false);

      assert.equal(isExecutionToolName(toolName), false);
      assert.deepEqual(getEvidence(), [], "log retrieval must not create execution or write evidence");
      const mismatches = crossReferenceEvidence(
        [{ command: "pnpm test", exitCode: 0, verdict: "passed" }],
        getEvidence(),
      );
      assert.equal(mismatches.length, 1);
      assert.equal(mismatches[0].severity, "warning");
      assert.equal(mismatches[0].actual, null);
      assert.match(mismatches[0].reason, /No bash tool call found/);
    });
  }
}

test("evidence-collector: query is not a fallback execution command", () => {
  resetEvidence();
  recordToolCall("tc-query-only", "gsd_exec", { query: "pnpm test" });
  recordToolResult("tc-query-only", "gsd_exec", gsdExecResult(0), false);
  const bash = getEvidence().filter((e): e is BashEvidence => e.kind === "bash");
  assert.equal(bash[0].command, "");
  assert.equal(crossReferenceEvidence(
    [{ command: "pnpm test", exitCode: 0, verdict: "passed" }],
    getEvidence(),
  ).length, 1);
});

test("evidence-xref: blank-command evidence does not satisfy arbitrary claims", () => {
  // Before script extraction existed, gsd_exec calls were recorded with
  // command: "" — and `"x".includes("")` made them match every claim,
  // masking genuine fabrications. Blank entries must never match.
  const mismatches = crossReferenceEvidence(
    [{ command: "node --test tests/verify-s01.test.js", exitCode: 0, verdict: "passed" }],
    [{
      kind: "bash",
      toolCallId: "tc-blank",
      command: "",
      exitCode: 0,
      outputSnippet: "",
      timestamp: 1,
    }],
  );

  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].severity, "warning");
  assert.match(mismatches[0].reason, /No bash tool call found/);
});

test("evidence-collector: exit code falls back to .gsd/exec meta.json when result text omits it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-exec-meta-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const metaPath = join(dir, "run-1.meta.json");
  writeFileSync(metaPath, JSON.stringify({ id: "run-1", exit_code: 7 }));

  resetEvidence();
  recordToolCall("tc-meta-1", "gsd_exec", { script: "exit 7" });
  // Truncated result: meta_path survives but exit_code was cut off.
  recordToolResult(
    "tc-meta-1",
    "gsd_exec",
    { content: [{ type: "text", text: `{"operation":"gsd_exec","meta_path":${JSON.stringify(metaPath)}` }] },
    false,
  );

  const bash = getEvidence().filter((e): e is BashEvidence => e.kind === "bash");
  assert.equal(bash[0].exitCode, 7, "exit code must be recovered from meta.json");
});
