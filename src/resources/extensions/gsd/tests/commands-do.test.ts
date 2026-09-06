import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";
import * as commands from "../commands-do.ts";

const routes = [
  ["show me progress", "status", ""],
  ["STATUS", "status", ""],
  ["status?", "status", ""],
  ["show me status?", "status", ""],
  ["run autonomously", "auto", ""],
  ["clean up old branches", "cleanup", "old branches"],
  ["create pr for milestone", "ship", "for milestone"],
  ["add tests for S03", "add-tests", "for S03"],
  ["check health of the system", "doctor", "of the system"],
  ["debug this flaky oauth callback", "debug", "this flaky oauth callback"],
  ["show me debug logs for today", "logs", "for today"],
  ["debug logs for the last run", "logs", "for the last run"],
  ["show me the session report", "session-report", ""],
  ["what is my context usage", "usage", ""],
  ["show me a context breakdown", "context", ""],
  ["what is using context", "context", ""],
  ["history --cost 5", "history", "--cost 5"],
  ["logs tail 10", "logs", "tail 10"],
  ["context --json", "context", "--json"],
  ["diagnose issue with oauth callback", "debug", "with oauth callback"],
  ["investigate flaky test in CI", "debug", "flaky test in CI"],
  ["diagnose my project", "doctor", "my project"],
  ["pr branch M002", "pr-branch", "M002"],
  ["migrate old project", "migrate", "old project"],
  ["steer toward smaller tasks", "steer", "toward smaller tasks"],
  ["park M002", "park", "M002"],
  ["toggle widget", "widget", ""],
  ["next", "next", ""],
  ["what's next", "status", ""],
  ["what’s next?", "status", ""],
  ["what is next", "status", ""],
  ["현재 상태 알려줘", "status", ""],
  ["현재 상태가 어때?", "status", ""],
  ["현재 상태가 어때?".normalize("NFD"), "status", ""],
  ["진행 상황 보여줘", "status", ""],
  ["상태 보여줘".normalize("NFD"), "status", ""],
  ["작업 이력 보여줘", "history", ""],
  ["히스토리 알려줘", "history", ""],
  ["로그 보여줘", "logs", ""],
  ["debug 로그 보여줘", "logs", ""],
  ["컨텍스트 사용량 알려줘", "usage", ""],
  ["토큰 사용량 보여줘", "usage", ""],
  ["컨텍스트 구성 보여줘", "context", ""],
  ["context 사용량 보여줘", "usage", ""],
  ["컨텍스트 알려줘", "context", ""],
  ["merge 하지 말고 상태만 알려줘", "status", ""],
  ["cleanup 하지 말고 로그만 보여줘", "logs", ""],
] as const;

for (const [input, command, remainingArgs] of routes) {
  test("/gsd do resolves " + JSON.stringify(input) + " through production code", () => {
    assert.deepEqual(commands.resolveDoIntent(input), { kind: "command", command, remainingArgs });
  });
}

const clarificationInputs = [
  "florbinate the gizmo",
  "안녕하세요",
  "도와줘",
  "로그인",
  "자동차",
  "자동완성",
  "shipping label",
  "autofocus input",
  "contextual hints",
  "captureless group",
  "nextdoor",
  "what happens if we merge?",
  "what happens if we merge",
  "should we cleanup old branches",
  "could you run all tasks",
  "can you fix the login bug?",
  "why debug this issue",
  "merge?",
  "cleanup if tests pass",
  "auto when ready",
  "next is dangerous",
  "merge 하지 마",
  "merge 말아줘",
  "merge 금지",
  "ship 안돼",
  "ship 안 돼",
  "merge 하지 말아줘",
  "ship 하면 어떻게 돼",
  "cleanup 가능한가요",
  "auto 실행하지마",
  "다음 단계 실행하지 말아줘",
  "로그인 오류를 수정해줄까?",
  "로그인 오류를 수정하지 말아줘",
  "로그인 오류를 수정해줘도 될까",
  "로그인 오류 수정할 수 있어?",
  "do not merge",
  "don't cleanup",
  "don’t run all",
  "never ship",
  "no auto",
  "please do not fix the bug",
  "fix the login bug only if approved",
  "fix nothing",
  "I am thinking about merge",
  "tell me about auto",
  "the word cleanup is in a message",
  "status page needs cleanup",
  "note",
  "메모",
  "capture? do not merge",
  "note this if approved",
  "show me logs clear",
  "debug logs clear",
  "session report --save",
  "show me session report --save",
  "show me session report --saved",
  "session report output--save",
  "merge could we",
  "ship should we",
  "capture 하지 마",
  "메모 금지",
  "메모해 말아줘",
  "capture 안돼",
  "capture 안 돼",
];

for (const input of clarificationInputs) {
  test("/gsd do leaves ambiguous input " + JSON.stringify(input) + " unrouted", () => {
    assert.deepEqual(commands.resolveDoIntent(input), { kind: "clarify" });
  });
}

for (const input of [
  "fix the login bug",
  "please fix the login bug",
  "implement a history button",
  "fix the merge button",
  "merge.md 파일을 수정해줘",
  "ship.ts 오류를 수정해줘",
  "add a cleanup reminder",
  "로그인 오류를 수정해줘",
  "로그인 오류를 수정해줘".normalize("NFD"),
  "로그인 페이지를 만들어줘",
]) {
  test("/gsd do quick requires explicit task intent: " + JSON.stringify(input), () => {
    assert.deepEqual(commands.resolveDoIntent(input), { kind: "quick", remainingArgs: input });
  });
}

for (const [input, body] of [
  ["note: merge later; do not ship", "merge later; do not ship"],
  ["capture fix the login bug later", "fix the login bug later"],
  ["remember: don't cleanup the branch", "don't cleanup the branch"],
  ["remember don't cleanup later", "don't cleanup later"],
  ["메모: 나중에 merge; 자동 실행하지 마", "나중에 merge; 자동 실행하지 마"],
  ["메모: 금지", "금지"],
  ["메모해 다음에 결제 검증 추가", "다음에 결제 검증 추가"],
  ["기억해줘: 로그인 오류는 나중에 수정해줘", "로그인 오류는 나중에 수정해줘"],
  ["메모해줘: 나중에  merge\n하지 마  ", "나중에  merge\n하지 마  "],
  ["메모: 로그인 오류".normalize("NFD"), "로그인 오류".normalize("NFD")],
]) {
  test("/gsd do capture preserves its body: " + JSON.stringify(input), () => {
    assert.deepEqual(commands.resolveDoIntent(input), { kind: "command", command: "capture", remainingArgs: body });
  });
}

function recordingHandler() {
  const notifications: Array<{ message: string; level: string | undefined }> = [];
  const executions: Array<{ kind: "command" | "quick"; args: string }> = [];
  const ctx = { ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } } as unknown as ExtensionCommandContext;
  const pi = {} as ExtensionAPI;
  const dispatch = {
    command: async (args: string) => { executions.push({ kind: "command", args }); },
    quick: async (args: string) => { executions.push({ kind: "quick", args }); },
  };
  return { notifications, executions, ctx, pi, dispatch };
}

test("/gsd do handler notifies with the unchanged request and never executes unclear input", async () => {
  for (const input of clarificationInputs) {
    const record = recordingHandler();
    await commands.handleDo(input, record.ctx, record.pi, record.dispatch);
    assert.deepEqual(record.executions, [], input);
    assert.equal(record.notifications.length, 1, input);
    assert.equal(record.notifications[0].level, "warning", input);
    assert.ok(record.notifications[0].message.includes(input), input);
    assert.match(record.notifications[0].message, /\/gsd help/);
  }
});

test("/gsd do handler can reject unclear input without loading any runtime dependencies", async () => {
  const record = recordingHandler();
  await commands.handleDo("florbinate the gizmo", record.ctx, record.pi);
  assert.equal(record.notifications.length, 1);
  assert.equal(record.notifications[0].level, "warning");
});

test("/gsd do handler dispatches the resolver result exactly once", async () => {
  for (const [input, expected] of [
    ["merge 하지 말고 상태만 알려줘", { kind: "command", args: "status" }],
    ["show me debug logs for today", { kind: "command", args: "logs for today" }],
    ["what’s next?", { kind: "command", args: "status" }],
    ["note: later, do not merge", { kind: "command", args: "capture later, do not merge" }],
    ["로그인 오류를 수정해줘", { kind: "quick", args: "로그인 오류를 수정해줘" }],
  ] as const) {
    const record = recordingHandler();
    await commands.handleDo(input, record.ctx, record.pi, record.dispatch);
    assert.deepEqual(record.executions, [expected]);
    assert.equal(record.notifications.length, 1);
  }
});

test("/gsd do handler empty input shows usage without executing", async () => {
  const record = recordingHandler();
  await commands.handleDo("   ", record.ctx, record.pi, record.dispatch);
  assert.deepEqual(record.executions, []);
  assert.match(record.notifications[0].message, /Usage: \/gsd do/);
});
