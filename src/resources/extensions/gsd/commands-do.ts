/**
 * GSD Command — /gsd do
 *
 * A small, deterministic shorthand grammar, not a general natural-language
 * classifier. Unrecognized requests stay unrouted; explicit /gsd commands remain
 * available when the shorthand cannot establish an execution intent.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";

export type DoIntent =
  | { kind: "command"; command: string; remainingArgs: string }
  | { kind: "quick"; remainingArgs: string }
  | { kind: "clarify" };

interface Route {
  keywords: string[];
  command: string;
}

const ROUTES: Route[] = [
  { keywords: ["progress", "status", "dashboard", "how far", "where are we"], command: "status" },
  { keywords: ["auto", "autonomous", "run autonomously", "run all", "keep going", "start auto"], command: "auto" },
  { keywords: ["stop", "halt", "abort"], command: "stop" },
  { keywords: ["pause", "break", "take a break"], command: "pause" },
  { keywords: ["history", "past", "what happened", "previous"], command: "history" },
  { keywords: ["doctor", "health", "diagnose", "check health"], command: "doctor" },
  { keywords: ["clean up", "cleanup", "remove old", "prune", "tidy"], command: "cleanup" },
  { keywords: ["export", "report", "share results"], command: "export" },
  { keywords: ["ship", "pull request", "create pr", "open pr", "merge"], command: "ship" },
  { keywords: ["discuss", "talk about", "architecture", "design"], command: "discuss" },
  { keywords: ["undo", "revert", "rollback", "take back"], command: "undo" },
  { keywords: ["skip", "skip task", "skip this"], command: "skip" },
  { keywords: ["queue", "reorder", "milestone order", "order milestones"], command: "queue" },
  { keywords: ["visualize", "viz", "graph", "chart", "show graph"], command: "visualize" },
  { keywords: ["inspect", "database", "sqlite", "db state"], command: "inspect" },
  { keywords: ["knowledge", "rule", "pattern", "lesson"], command: "knowledge" },
  { keywords: ["usage", "context usage", "context window", "how much context", "token usage", "tokens used"], command: "usage" },
  { keywords: ["context", "context breakdown", "what is using context", "skills in context", "agents in context"], command: "context" },
  { keywords: ["session-report", "session report", "session summary", "cost summary", "how much"], command: "session-report" },
  { keywords: ["backlog", "parking lot", "later", "someday"], command: "backlog" },
  { keywords: ["pr branch", "clean branch", "filter commits"], command: "pr-branch" },
  { keywords: ["add tests", "write tests", "generate tests", "test coverage"], command: "add-tests" },
  { keywords: ["next", "step", "next step"], command: "next" },
  { keywords: ["migrate", "migration", "convert", "upgrade"], command: "migrate" },
  { keywords: ["steer", "change direction", "pivot", "redirect"], command: "steer" },
  { keywords: ["park", "shelve", "set aside"], command: "park" },
  { keywords: ["widget", "toggle widget"], command: "widget" },
  { keywords: ["logs", "debug logs", "log files"], command: "logs" },
  { keywords: ["debug", "debug session", "investigate", "troubleshoot", "diagnose issue"], command: "debug" },
];

const READ_COMMANDS = new Set(["status", "history", "logs", "usage", "context", "session-report"]);
const PREFIXES = ROUTES.flatMap(({ command, keywords }) =>
  keywords.map((keyword) => ({ command, keyword })),
).sort((a, b) => b.keyword.length - a.keyword.length);

const KOREAN_READ_ROUTES = [
  { subject: "(?:현재\\s*)?(?:진행\\s*(?:상황|상태)|상태|현황|status)", command: "status" },
  { subject: "(?:작업\\s*)?(?:이력|기록)|히스토리|history", command: "history" },
  { subject: "(?:(?:debug|디버그)\\s*)?(?:로그|logs)", command: "logs" },
  { subject: "(?:컨텍스트|문맥|context|토큰|token)\\s*사용량", command: "usage" },
  { subject: "(?:컨텍스트|문맥|context)(?:\\s*(?:구성|내역|분석))?", command: "context" },
].map(({ subject, command }) => ({
  command,
  pattern: new RegExp(
    "^(?:" + subject + ")(?:[을를이가은는]|만)?\\s*(?:(?:보여|알려)\\s*(?:줘|주세요)|확인해\\s*줘|어때|어떤가요)?[.!?？]?$",
    "iu",
  ),
}));

// These guards deliberately reject more than they recognize. They are not a
// safety classifier for arbitrary prose; unsupported grammar needs an explicit
// command. Capture bodies are data and are handled separately before this guard.
function lacksExecutionIntent(input: string): boolean {
  return /[?？]/u.test(input)
    || /\b(?:not|no|never|nothing|don['’]t|doesn['’]t|isn['’]t|can['’]t|won['’]t|shouldn['’]t|wouldn['’]t|if|unless|when|whether|could|should|would|might|maybe|perhaps|later|someday)\b/iu.test(input)
    || /^(?:what|why|how|who|where|can|could|should|would|will|is|are|do|does)\b/iu.test(input)
    || /(?:하지\s*(?:마|말)|실행하지|안\s*(?:해|하|실행|돼|되)|않|말고|말아|마세요|금지|하면|할까|될까|가능한|어떻게|할\s*수\s*있)/u.test(input);
}

function afterPrefix(original: string, normalizedPrefix: string): string {
  // NFC is for comparison only. Locate the matched prefix in the original text
  // so decomposed Korean and all capture/task body whitespace survive unchanged.
  let prefix = "";
  for (const char of original) {
    prefix += char;
    if (prefix.normalize("NFC") === normalizedPrefix) {
      return original.slice(prefix.length);
    }
  }
  return original;
}

function commandIntent(command: string, remainingArgs = ""): DoIntent {
  return { kind: "command", command, remainingArgs };
}

/** Resolve only recognized shorthand; this function never imports the runtime. */
export function resolveDoIntent(input: string): DoIntent {
  const original = input.trimStart();
  const normalized = original.normalize("NFC");
  const text = normalized.trim();
  if (!text) return { kind: "clarify" };

  const capture = normalized.match(/^(?:please\s+)?(?:capture|note|remember|메모해\s*줘|메모해|메모|기억해\s*줘|기록해\s*줘)(?::\s*|\s+)([\s\S]*)$/iu);
  if (capture) {
    const body = capture[1];
    const head = capture[0].slice(0, capture[0].length - body.length);
    // A colon marks the body explicitly. Without it, conditional requests remain
    // ambiguous, while reminders such as "remember don't merge later" are data.
    if (!body.trim() || (!head.includes(":") && (/[?？]|\b(?:if|unless|when|whether)\b/iu.test(body)
      || /^(?:하지\s*(?:마|말)|말아|마세요|금지|안\s*(?:해|하|돼|되)|하면|할까)/u.test(body)))) {
      return { kind: "clarify" };
    }
    return commandIntent("capture", afterPrefix(original, head));
  }

  if (/^what(?:['’]s| is) next[?？.]?$/iu.test(text)) return commandIntent("status");

  // A denied action followed by an explicit Korean read request may safely show
  // that view, but none of the denied clause is forwarded as command arguments.
  const readText = text.replace(/^.+하지\s*말고\s*/u, "");
  for (const route of KOREAN_READ_ROUTES) {
    if (route.pattern.test(readText)) return commandIntent(route.command);
  }

  // Keep direct read aliases such as "what is using context" ahead of wrappers.
  const directRead = PREFIXES.find((route) => READ_COMMANDS.has(route.command) && text.toLowerCase() === route.keyword);
  if (directRead) return commandIntent(directRead.command);

  const readPrefix = text.match(/^(?:show(?: me)?|display|what is(?: my| the)?)(?:\s+(?:a|the|my))?\s+/iu)?.[0] ?? "";
  const politePrefix = !readPrefix ? text.match(/^please\s+/iu)?.[0] ?? "" : "";
  const prefix = readPrefix || politePrefix;
  const candidate = text.slice(prefix.length);
  for (const route of PREFIXES) {
    const match = candidate.match(new RegExp("^" + route.keyword + "(?=$|\\s|[?？.](?:$|\\s))", "iu"));
    if (!match) continue;
    const remainingArgs = afterPrefix(original, prefix + match[0]).trim();
    if (readPrefix && !READ_COMMANDS.has(route.command)) return { kind: "clarify" };

    if (READ_COMMANDS.has(route.command)) {
      // Never smuggle mutating options through an informational request.
      // Match the existing report handler's substring flag check as well:
      // it treats --saved and embedded --save as requests to write a report.
      if (/^(?:clear|delete|remove)\b/iu.test(remainingArgs) || remainingArgs.toLowerCase().includes("--save")) return { kind: "clarify" };
      if (route.command === "status" && remainingArgs && !/^[?？.]$/u.test(remainingArgs)) return { kind: "clarify" };
      if (!/^[?？.]$/u.test(remainingArgs) && lacksExecutionIntent(remainingArgs)) return { kind: "clarify" };
      return commandIntent(route.command, /^[?？.]$/u.test(remainingArgs) ? "" : remainingArgs);
    }

    if (lacksExecutionIntent(text) || /\b(?:is|are|was|were|means)\b/iu.test(remainingArgs)) return { kind: "clarify" };
    return commandIntent(route.command, remainingArgs);
  }

  if (lacksExecutionIntent(text)) return { kind: "clarify" };
  if (/^(?:please\s+)?(?:fix|implement|build|create|add|update|refactor|write|remove|repair)\s+\S/iu.test(text)
    || /^.+(?:수정|구현|추가|개선|작성|고쳐|만들어)(?:해)?\s*(?:줘|주세요)[.!]?$/u.test(text)) {
    return { kind: "quick", remainingArgs: input };
  }
  return { kind: "clarify" };
}

type DoHandler = (args: string, ctx: ExtensionCommandContext, pi: ExtensionAPI) => Promise<void>;

interface DoDispatch {
  command: DoHandler;
  quick: DoHandler;
}

// Internal dependency seam for handler tests; production keeps the normal
// dispatcher and all its guards. No alternate route is used by actual callers.
const defaultDispatch: DoDispatch = {
  command: async (...args) => {
    const { handleGSDCommand } = await import("./commands/dispatcher.js");
    await handleGSDCommand(...args);
  },
  quick: async (...args) => {
    const { handleQuick } = await import("./quick.js");
    await handleQuick(...args);
  },
};

export async function handleDo(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  dispatch: DoDispatch = defaultDispatch,
): Promise<void> {
  if (!args.trim()) {
    ctx.ui.notify(
      "Usage: /gsd do <what you want to do>\n\n" +
      "Examples:\n" +
      "  /gsd do show me progress\n" +
      "  /gsd do 현재 상태 알려줘\n" +
      "  /gsd do run autonomously\n" +
      "  /gsd do fix the login bug",
      "warning",
    );
    return;
  }

  const intent = resolveDoIntent(args);
  if (intent.kind === "clarify") {
    ctx.ui.notify(
      "요청을 자동으로 실행하지 않았습니다. 명시적인 /gsd 명령을 사용해 주세요 (/gsd help).\n" +
      "No command was started. Use an explicit /gsd command; see /gsd help.\n\n" +
      "Original request / 원래 요청:\n" + args,
      "warning",
    );
    return;
  }

  if (intent.kind === "command") {
    const fullCommand = intent.remainingArgs ? intent.command + " " + intent.remainingArgs : intent.command;
    ctx.ui.notify("→ /gsd " + fullCommand, "info");
    await dispatch.command(fullCommand, ctx, pi);
    return;
  }

  ctx.ui.notify("→ /gsd quick " + intent.remainingArgs, "info");
  await dispatch.quick(intent.remainingArgs, ctx, pi);
}
