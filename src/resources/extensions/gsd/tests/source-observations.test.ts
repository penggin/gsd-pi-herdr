import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SourceObservationStore,
  injectSourceContextBlockIntoPayload,
  observeSourcePath,
  planDeclaredSourceEntries,
} from "../source-observations.js";
import { AutoSession } from "../auto/session.js";
import { truncateContextResultMessages, truncateResponsesInputResultItems } from "../context-masker.js";
import type { TaskRow } from "../db-task-slice-rows.js";

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    milestone_id: "M001",
    slice_id: "S01",
    id: "T01",
    title: "Task",
    status: "pending",
    one_liner: "",
    narrative: "",
    verification_result: "",
    duration: "",
    completed_at: null,
    blocker_discovered: false,
    deviations: "",
    known_issues: "",
    key_files: [],
    key_decisions: [],
    full_summary_md: "",
    description: "",
    estimate: "",
    files: [],
    verify: "",
    inputs: [],
    expected_output: [],
    observability_impact: "",
    full_plan_md: "",
    sequence: 1,
    blocker_source: "",
    escalation_pending: 0,
    escalation_awaiting_review: 0,
    escalation_artifact_path: null,
    escalation_override_applied_at: null,
    ...overrides,
  };
}

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "gsd-source-observations-"));
}

function beginStore(basePath: string): SourceObservationStore {
  const store = new SourceObservationStore();
  store.beginUnit({ unitType: "execute-task", unitId: "M001/S01/T01", startedAt: 123, basePath });
  return store;
}

test("plan-declared source entries use task.files and concrete task.inputs, not expectedOutput", () => {
  const task = makeTask({
    files: ["src/app.ts"],
    inputs: ["Current enum shape", "`src/input.ts` - existing input"],
    expected_output: ["src/generated.ts"],
  });

  assert.deepEqual(planDeclaredSourceEntries(task), [
    { path: "src/app.ts", field: "files" },
    { path: "src/input.ts", field: "inputs" },
  ]);
});

test("preloaded plan observations render whole files and unavailable statuses", () => {
  const basePath = tempProject();
  mkdirSync(join(basePath, "src"), { recursive: true });
  writeFileSync(join(basePath, "src", "app.ts"), "export const value = 1;\n");
  mkdirSync(join(basePath, "src", "directory"), { recursive: true });
  writeFileSync(join(basePath, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const store = beginStore(basePath);
  store.observePlanTask(makeTask({
    files: [
      "src/app.ts",
      "src/missing.ts",
      "src/*.ts",
      "src/directory/",
      "image.png",
    ],
  }));

  const block = store.renderActiveBlock();
  assert.ok(block);
  assert.match(block, /## Source Context Block/);
  assert.match(block, /#### src\/app\.ts/);
  assert.match(block, /export const value = 1;/);
  assert.match(block, /src\/missing\.ts: missing/);
  assert.match(block, /src\/\*\.ts: glob/);
  assert.match(block, /src\/directory: directory/);
  assert.match(block, /image\.png: binary\/image/);
});

test("narrow reads of under-threshold files auto-upgrade to whole-file observations", () => {
  const basePath = tempProject();
  mkdirSync(join(basePath, "src"), { recursive: true });
  writeFileSync(join(basePath, "src", "app.ts"), ["line one", "line two", "line three"].join("\n"));

  const store = beginStore(basePath);
  store.observeRead({ path: "src/app.ts", offset: 2, limit: 1 });

  const block = store.renderActiveBlock();
  assert.ok(block);
  assert.match(block, /line one/);
  assert.match(block, /line two/);
  assert.match(block, /line three/);
});

test("successful file mutations refresh active whole-file observations", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "app.ts"), "export const value = 'before';\n");

  const store = beginStore(basePath);
  store.observeRead({ path: "app.ts" });

  assert.match(store.renderActiveBlock() ?? "", /before/);

  writeFileSync(join(basePath, "app.ts"), "export const value = 'after';\n");
  store.observeMutation({ path: "app.ts" });

  const block = store.renderActiveBlock() ?? "";
  assert.match(block, /after/);
  assert.doesNotMatch(block, /before/);
});

test("anchored source describes latest recorded mutations despite later historical read results", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "app.ts"), "export const value = 1;\n");
  const store = beginStore(basePath);
  store.observeRead({ path: "app.ts" });
  const user = { role: "user", content: "Change the value to 2" };
  const historicalRead = { role: "toolResult", toolCallId: "read1", content: [{ type: "text", text: "export const value = 1;" }] };
  const historicalEdit = { role: "toolResult", toolCallId: "edit1", content: [{ type: "text", text: "updated" }] };
  writeFileSync(join(basePath, "app.ts"), "export const value = 2;\n");
  store.observeMutation({ path: "app.ts" });
  const history = [user, { role: "assistant", content: "read" }, historicalRead, { role: "assistant", content: "edit" }, historicalEdit];
  const output = injectSourceContextBlockIntoPayload({ messages: history }, store.renderActiveBlock()!).messages as any[];
  const block = output[1].content[0].text;
  assert.match(block, /latest available observations for this request, including recorded mutations/);
  assert.match(block, /Later historical tool results may describe an earlier state/);
  assert.match(block, /export const value = 2/);
  assert.doesNotMatch(block, /export const value = 1/);
  assert.deepEqual(output.slice(2), history.slice(1));
  assert.equal(historicalRead.content[0].text, "export const value = 1;");
});

test("recorded deletion replaces source bytes with unavailable status, and a new unit clears observations", () => {
  const basePath = tempProject();
  const file = join(basePath, "app.ts");
  writeFileSync(file, "export const deleted = true;\n");
  const store = beginStore(basePath);
  store.observeRead({ path: "app.ts" });
  unlinkSync(file);
  store.observeMutation({ path: "app.ts" });
  const block = store.renderActiveBlock() ?? "";
  assert.match(block, /app\.ts: missing/);
  assert.doesNotMatch(block, /export const deleted/);
  store.beginUnit({ unitType: "execute-task", unitId: "M001/S01/T02", startedAt: 124, basePath });
  assert.equal(store.renderActiveBlock(), null);
});

test("successful writes promote missing plan observations to whole files", () => {
  const basePath = tempProject();
  const store = beginStore(basePath);
  store.observePlanTask(makeTask({ files: ["generated.ts"] }));

  assert.match(store.renderActiveBlock() ?? "", /generated\.ts: missing/);

  writeFileSync(join(basePath, "generated.ts"), "export const generated = true;\n");
  store.observeMutation({ path: "generated.ts" });

  const block = store.renderActiveBlock() ?? "";
  assert.match(block, /#### generated\.ts/);
  assert.match(block, /export const generated = true;/);
  assert.doesNotMatch(block, /generated\.ts: missing/);
});

test("over-threshold files are explicit unavailable observations", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "large.txt"), "a".repeat(51 * 1024));

  const observation = observeSourcePath(basePath, "large.txt", "plan");

  assert.equal(observation.status, "over-threshold");
  assert.match(observation.reason ?? "", /exceeds/);
});

test("outside-root paths are unavailable and never inlined", () => {
  const root = tempProject();
  const basePath = join(root, "project");
  const outsidePath = join(root, "outside");
  mkdirSync(basePath, { recursive: true });
  mkdirSync(outsidePath, { recursive: true });
  writeFileSync(join(outsidePath, "secret.txt"), "do not inline me\n");

  const absoluteObservation = observeSourcePath(basePath, join(outsidePath, "secret.txt"), "read");
  const relativeObservation = observeSourcePath(basePath, "../outside/secret.txt", "read");

  assert.equal(absoluteObservation.status, "unresolved selector");
  assert.equal(relativeObservation.status, "unresolved selector");
  assert.match(absoluteObservation.reason ?? "", /outside active Unit root/);
  assert.match(relativeObservation.reason ?? "", /outside active Unit root/);
  assert.equal(absoluteObservation.text, undefined);
  assert.equal(relativeObservation.text, undefined);
});

test("source observations only render for execute-task units", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "plan.md"), "planning context\n");

  const store = new SourceObservationStore();
  store.beginUnit({ unitType: "plan-slice", unitId: "M001/S01", startedAt: 123, basePath });
  store.observeRead({ path: "plan.md" });

  assert.equal(store.renderActiveBlock(), null);
});

test("source context block injection survives tool-result truncation for messages payloads", () => {
  const payload = {
    messages: truncateContextResultMessages([
      { role: "toolResult", content: [{ type: "text", text: "x".repeat(200) }], toolCallId: "read-1", toolName: "read", isError: false },
    ] as any, 10),
  };

  const injected = injectSourceContextBlockIntoPayload(payload, "## Source Context Block\n\nfull source text");

  assert.match((injected.messages as any[])[0].content[0].text, /truncated/);
  assert.equal((injected.messages as any[])[1].content[0].text, "## Source Context Block\n\nfull source text");
});

test("source context block injection supports Responses input payloads", () => {
  const payload = {
    input: truncateResponsesInputResultItems([
      { type: "function_call_output", call_id: "read-1", output: "x".repeat(200) },
    ] as any, 10),
  };

  const injected = injectSourceContextBlockIntoPayload(payload, "## Source Context Block\n\nfull source text");

  assert.match((injected.input as any[])[0].output, /truncated/);
  assert.equal((injected.input as any[])[1].content[0].text, "## Source Context Block\n\nfull source text");
});

const sourcePrefixFormats = [
  {
    name: "pi messages", key: "messages", user: { role: "user", content: [{ type: "text", text: "verify" }] },
    pair: (id: string) => [
      { role: "assistant", content: [{ type: "toolCall", id, name: "read", arguments: {} }] },
      { role: "toolResult", toolCallId: id, content: [{ type: "text", text: "result" }] },
    ],
  },
  {
    name: "Anthropic", key: "messages", user: { role: "user", content: [{ type: "text", text: "verify" }] },
    pair: (id: string) => [
      { role: "assistant", content: [{ type: "tool_use", id, name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "result" }] },
    ],
  },
  {
    name: "Chat Completions", key: "messages", user: { role: "user", content: "verify" },
    pair: (id: string) => [
      { role: "assistant", content: null, tool_calls: [{ type: "function", id, function: { name: "read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: id, content: "result" },
    ],
  },
  {
    name: "Responses", key: "input", user: { role: "user", content: [{ type: "input_text", text: "verify" }] },
    pair: (id: string) => [
      { type: "function_call", call_id: id, name: "read", arguments: "{}" },
      { type: "function_call_output", call_id: id, output: "result" },
    ],
  },
] as const;
const sourceSnapshotPlacementNotice = "This block contains GSD’s latest available observations for this request, including recorded mutations; " +
  "it is placed early for cache stability. Later historical tool results may describe an earlier state.";

for (const format of sourcePrefixFormats) {
  test(`${format.name} unchanged source retains the complete prefix across tool iterations`, () => {
    const block = `## Source Context Block\n\n${sourceSnapshotPlacementNotice}\n` + "const stableValue = 123;\n".repeat(1000);
    const firstPair = format.pair("call1");
    const history = [format.user, ...firstPair];
    const original = structuredClone(history);
    const initial = injectSourceContextBlockIntoPayload({ [format.key]: history }, block)[format.key] as unknown[];
    const secondPair = format.pair("call2");
    const next = injectSourceContextBlockIntoPayload({ [format.key]: [...history, ...secondPair] }, block)[format.key] as unknown[];
    assert.ok((initial[1] as any).content?.[0]?.text === block, "source must immediately follow the real user request");
    assert.ok(JSON.stringify(next.slice(0, initial.length)) === JSON.stringify(initial), "whole prior request must remain the byte prefix");
    assert.deepEqual(next.slice(-2), secondPair, "tool-call/result pairing must remain adjacent");
    assert.deepEqual(history, original);
    assert.equal(Buffer.byteLength(block), 25_025 + Buffer.byteLength(sourceSnapshotPlacementNotice) + 1);
  });
}

test("source anchor skips hidden context and shell-result user wrappers", () => {
  const user = { role: "user", content: [{ type: "input_text", text: "verify" }] };
  const wrappers = [
    { role: "user", content: [{ type: "input_text", text: "[GSD Context Injection]\ncontext" }] },
    { role: "user", content: [{ type: "input_text", text: "[GSD Guided Execute Context]\ncontext" }] },
    { role: "user", content: [{ type: "input_text", text: "Ran `test`\n```\nchecks passed\n```" }] },
  ];
  const result = injectSourceContextBlockIntoPayload({ input: [user, ...wrappers] }, "## Source Context Block\nsource").input as any[];
  assert.equal(result[0], user);
  assert.match(result[1].content[0].text, /Source Context Block/);
  assert.deepEqual(result.slice(2), wrappers);
});

test("source placement resets to the current user turn and compacted history without remembered state", () => {
  const oldUser = { role: "user", content: "first task" };
  const nextUser = { role: "user", content: "next task" };
  const pair = sourcePrefixFormats[2].pair("call1");
  const initial = injectSourceContextBlockIntoPayload({ messages: [oldUser, ...pair] }, "## Source Context Block\nold").messages as any[];
  const next = injectSourceContextBlockIntoPayload({ messages: [...initial, nextUser, ...pair] }, "## Source Context Block\nnew").messages as any[];
  const index = next.indexOf(nextUser);
  assert.equal(next[index + 1].content[0].text, "## Source Context Block\nnew");
  assert.equal(next.filter((item) => typeof item.content !== "string" && item.content?.[0]?.text?.startsWith("## Source Context Block")).length, 1);
  assert.deepEqual(next.slice(index + 2), pair);
  const compacted = injectSourceContextBlockIntoPayload({ messages: [nextUser] }, "## Source Context Block\nnew").messages as any[];
  assert.equal(compacted.length, 2);
  assert.equal(compacted[0], nextUser);
});

test("changed source replaces the anchored block without changing surrounding messages", () => {
  const history = [sourcePrefixFormats[0].user, ...sourcePrefixFormats[0].pair("call1")];
  const initial = injectSourceContextBlockIntoPayload({ messages: history }, "## Source Context Block\nold").messages as any[];
  const changed = injectSourceContextBlockIntoPayload({ messages: initial }, "## Source Context Block\nnew").messages as any[];
  assert.equal(changed[1].content[0].text, "## Source Context Block\nnew");
  assert.deepEqual(changed.filter((_, index) => index !== 1), history);
  assert.equal(initial[1].content[0].text, "## Source Context Block\nold");
});

test("ambiguous user shapes retain tail placement instead of splitting tool results", () => {
  for (const user of [
    { role: "user", content: "Ran `pnpm test` locally; please fix its failing case" },
    { role: "user", content: [
      { type: "text", text: "Ran `pnpm test`\n```\npassed\n```" },
      { type: "text", text: "Now inspect the deployment" },
    ] },
    { role: "user", content: [
      { type: "input_text", text: "Ran `pnpm test`\n(no output)" },
      { type: "input_image", image_url: "data:image/png;base64,fixture" },
    ] },
    { role: "user", content: { text: "unknown shape" } },
    { role: "user", content: [{ type: "unknown", text: "unknown shape" }] },
    { role: "user", content: [{ type: "tool_result", content: "result" }, { type: "text", text: "possibly a new request" }] },
  ]) {
    const history = [sourcePrefixFormats[0].user, ...sourcePrefixFormats[0].pair("call1"), user];
    const result = injectSourceContextBlockIntoPayload({ messages: history }, "## Source Context Block\nsource").messages as any[];
    assert.deepEqual(result.slice(0, history.length), history);
    assert.match(result.at(-1).content[0].text, /Source Context Block/);
  }
});

test("unit-close degradation removes active whole-file source text", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "app.ts"), "export const value = 1;");
  const store = beginStore(basePath);
  store.observeRead({ path: "app.ts" });

  assert.match(store.renderActiveBlock() ?? "", /export const value = 1/);

  store.degradeUnit({ unitType: "execute-task", unitId: "M001/S01/T01", startedAt: 123 });

  assert.equal(store.renderActiveBlock(), null);
});

test("AutoSession current-unit clear removes active source observations", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "app.ts"), "export const value = 1;");
  const session = new AutoSession();
  session.basePath = basePath;
  session.setCurrentUnit({
    type: "execute-task",
    id: "M001/S01/T01",
    startedAt: 123,
    workspaceRoot: basePath,
  });
  session.sourceObservations.observeRead({ path: "app.ts" });

  assert.match(session.sourceObservations.renderActiveBlock() ?? "", /export const value = 1/);

  session.clearCurrentUnit();

  assert.equal(session.sourceObservations.renderActiveBlock(), null);
});

test("AutoSession clears source observations when switching to non-execute units", () => {
  const basePath = tempProject();
  writeFileSync(join(basePath, "app.ts"), "export const value = 1;");
  const session = new AutoSession();
  session.basePath = basePath;
  session.setCurrentUnit({
    type: "execute-task",
    id: "M001/S01/T01",
    startedAt: 123,
    workspaceRoot: basePath,
  });
  session.sourceObservations.observeRead({ path: "app.ts" });

  assert.match(session.sourceObservations.renderActiveBlock() ?? "", /export const value = 1/);

  session.setCurrentUnit({
    type: "plan-slice",
    id: "M001/S01",
    startedAt: 124,
    workspaceRoot: basePath,
  });

  assert.equal(session.sourceObservations.renderActiveBlock(), null);
});
