import { spawn } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { redactAssessmentSecrets } from "./findings-schema.js";

export const ASSESSMENT_CONTEXT_ENV = "GSD_ASSESSMENT_CONTEXT_PATH";
export const ASSESSMENT_TOOL_NAMES = [
  "assessment_read",
  "assessment_list",
  "assessment_search",
  "assessment_git_read",
  "assessment_artifact_read",
  "assessment_verify",
] as const;

interface AssessmentToolContext {
  schemaVersion: 1;
  runId: string;
  repositoryRoots: Array<{ id: string; path: string }>;
  artifacts: Array<{ id: string; path: string }>;
  verifiers: Array<{
    id: string;
    command: string;
    args: string[];
    cwdRootId: string;
    timeoutMs: number;
  }>;
  capabilities: string[];
}

const MAX_READ_BYTES = 256 * 1024;
const MAX_TOOL_OUTPUT_BYTES = 1024 * 1024;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_FILES = 2_000;

function loadContext(path: string): AssessmentToolContext {
  if (!isAbsolute(path)) throw new Error("assessment context path must be absolute");
  if (lstatSync(path).isSymbolicLink()) throw new Error("assessment context path must not be a symlink");
  const value = JSON.parse(readFileSync(path, "utf8")) as AssessmentToolContext;
  if (value.schemaVersion !== 1 || typeof value.runId !== "string") {
    throw new Error("assessment context schema is invalid");
  }
  if (!Array.isArray(value.repositoryRoots) || !Array.isArray(value.artifacts) || !Array.isArray(value.verifiers)) {
    throw new Error("assessment context lists are invalid");
  }
  return value;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function rootById(context: AssessmentToolContext, rootId: string): { id: string; path: string } {
  const root = context.repositoryRoots.find((entry) => entry.id === rootId);
  if (!root) throw new Error(`repository root is not approved: ${rootId}`);
  return { ...root, path: realpathSync(root.path) };
}

function boundedRepositoryPath(context: AssessmentToolContext, rootId: string, requested: string): string {
  if (isAbsolute(requested)) throw new Error("assessment repository paths must be relative");
  const root = rootById(context, rootId);
  const lexical = resolve(root.path, requested || ".");
  if (!isWithin(root.path, lexical)) throw new Error("assessment path escapes the approved repository root");
  const resolved = realpathSync(lexical);
  if (!isWithin(root.path, resolved)) throw new Error("assessment path resolves outside the approved repository root");
  return resolved;
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function boundedRead(path: string): string {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error("assessment read target must be a file");
  if (stat.size > MAX_READ_BYTES) throw new Error(`assessment read exceeds ${MAX_READ_BYTES} bytes`);
  return readFileSync(path, "utf8");
}

function walkFiles(root: string, relativePath = "", output: string[] = []): string[] {
  if (output.length >= MAX_SEARCH_FILES) return output;
  const directory = join(root, relativePath);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (output.length >= MAX_SEARCH_FILES) break;
    if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") continue;
    const rel = relativePath ? join(relativePath, entry.name) : entry.name;
    if (entry.isDirectory()) walkFiles(root, rel, output);
    else if (entry.isFile()) output.push(rel);
  }
  return output;
}

async function runBoundedProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      shell: false,
      env: {
        PATH: process.env.PATH,
        CI: "1",
        NO_COLOR: "1",
        LANG: process.env.LANG ?? "C.UTF-8",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let timedOut = false;
    const append = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike>,
    ): Buffer<ArrayBufferLike> => {
      if (current.length >= MAX_TOOL_OUTPUT_BYTES) return current;
      return Buffer.concat([current, chunk.subarray(0, MAX_TOOL_OUTPUT_BYTES - current.length)]);
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    const abort = () => child.kill("SIGKILL");
    input.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      resolvePromise({
        exitCode: code ?? 1,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
      });
    });
  });
}

export function registerAssessmentGateTools(pi: ExtensionAPI, contextPath: string): void {
  const context = loadContext(contextPath);
  const has = (capability: string) => context.capabilities.includes(capability);

  pi.registerTool({
    name: "assessment_read",
    label: "Assessment Read",
    description: "Read one bounded file inside an approved repository root.",
    parameters: Type.Object({ rootId: Type.String(), path: Type.String() }),
    async execute(_id, params) {
      if (!has("repository.read")) throw new Error("repository.read was not approved");
      const path = boundedRepositoryPath(context, params.rootId, params.path);
      return textResult(boundedRead(path), { path: params.path, rootId: params.rootId });
    },
  });

  pi.registerTool({
    name: "assessment_list",
    label: "Assessment List",
    description: "List a bounded directory inside an approved repository root.",
    parameters: Type.Object({ rootId: Type.String(), path: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      if (!has("repository.read")) throw new Error("repository.read was not approved");
      const path = boundedRepositoryPath(context, params.rootId, params.path ?? ".");
      const entries = readdirSync(path, { withFileTypes: true }).slice(0, MAX_LIST_ENTRIES)
        .map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`);
      return textResult(entries.join("\n"), { count: entries.length, truncated: entries.length === MAX_LIST_ENTRIES });
    },
  });

  pi.registerTool({
    name: "assessment_search",
    label: "Assessment Search",
    description: "Literal bounded text search inside an approved repository root.",
    parameters: Type.Object({ rootId: Type.String(), query: Type.String({ minLength: 1, maxLength: 256 }), path: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      if (!has("repository.read")) throw new Error("repository.read was not approved");
      const searchRoot = boundedRepositoryPath(context, params.rootId, params.path ?? ".");
      const matches: string[] = [];
      for (const rel of walkFiles(searchRoot)) {
        if (matches.length >= 200) break;
        const file = join(searchRoot, rel);
        const stat = statSync(file);
        if (stat.size > MAX_READ_BYTES) continue;
        let content: string;
        try { content = readFileSync(file, "utf8"); } catch { continue; }
        content.split(/\r?\n/).forEach((line, index) => {
          if (matches.length < 200 && line.toLowerCase().includes(params.query.toLowerCase())) {
            matches.push(`${rel}:${index + 1}:${line.slice(0, 500)}`);
          }
        });
      }
      return textResult(matches.join("\n"), { matches: matches.length, truncated: matches.length === 200 });
    },
  });

  pi.registerTool({
    name: "assessment_git_read",
    label: "Assessment Git Read",
    description: "Run a fixed read-only Git status, diff, or log operation.",
    parameters: Type.Object({
      rootId: Type.String(),
      action: Type.Union([Type.Literal("status"), Type.Literal("diff"), Type.Literal("log")]),
      staged: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    async execute(_id, params, signal) {
      if (!has("repository.read")) throw new Error("repository.read was not approved");
      const root = rootById(context, params.rootId);
      const args = params.action === "status"
        ? ["status", "--short", "--branch"]
        : params.action === "log"
          ? ["log", "--oneline", "--no-decorate", `-${params.limit ?? 20}`]
          : ["diff", "--no-ext-diff", ...(params.staged ? ["--cached"] : [])];
      const result = await runBoundedProcess({ command: "git", args, cwd: root.path, timeoutMs: 30_000, signal });
      return textResult(redactAssessmentSecrets(`${result.stdout}${result.stderr}`), {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      });
    },
  });

  pi.registerTool({
    name: "assessment_artifact_read",
    label: "Assessment Artifact Read",
    description: "Read one host-approved GSD artifact by opaque ID.",
    parameters: Type.Object({ artifactId: Type.String() }),
    async execute(_id, params) {
      if (!has("artifacts.read")) throw new Error("artifacts.read was not approved");
      const artifact = context.artifacts.find((entry) => entry.id === params.artifactId);
      if (!artifact) throw new Error(`artifact is not approved: ${params.artifactId}`);
      if (lstatSync(artifact.path).isSymbolicLink()) throw new Error("artifact must not be a symlink");
      return textResult(boundedRead(realpathSync(artifact.path)), { artifactId: params.artifactId });
    },
  });

  pi.registerTool({
    name: "assessment_verify",
    label: "Assessment Verifier",
    description: "Run one host-approved verifier by ID. Commands and arguments cannot be supplied by the gate.",
    parameters: Type.Object({ verifierId: Type.String() }),
    async execute(_id, params, signal) {
      if (!has("process.verification")) throw new Error("process.verification was not approved");
      const verifier = context.verifiers.find((entry) => entry.id === params.verifierId);
      if (!verifier) throw new Error(`verifier is not approved: ${params.verifierId}`);
      const root = rootById(context, verifier.cwdRootId);
      const result = await runBoundedProcess({
        command: verifier.command,
        args: verifier.args,
        cwd: root.path,
        timeoutMs: Math.min(Math.max(verifier.timeoutMs, 1_000), 10 * 60_000),
        signal,
      });
      return textResult(redactAssessmentSecrets(`${result.stdout}${result.stderr}`), {
        verifierId: verifier.id,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      });
    },
  });
}
