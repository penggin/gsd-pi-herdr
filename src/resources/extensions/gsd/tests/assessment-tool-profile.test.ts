import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAssessmentGateTools } from "../assessment-gates/tool-profile.ts";

type RegisteredTool = {
  name: string;
  execute: (...args: any[]) => Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;
};

function setup(capabilities: string[] = ["repository.read", "artifacts.read", "process.verification"]) {
  const base = mkdtempSync(join(tmpdir(), "gsd-assessment-tools-"));
  const repo = join(base, "repo");
  const artifacts = join(base, "artifacts");
  mkdirSync(repo);
  mkdirSync(artifacts);
  writeFileSync(join(repo, "source.ts"), "export const marker = 'safe';\n");
  writeFileSync(join(artifacts, "validation.md"), "validated evidence\n");
  writeFileSync(join(base, "outside.txt"), "outside\n");
  symlinkSync(join(base, "outside.txt"), join(repo, "escape-link"));
  const context = join(base, "context.json");
  writeFileSync(context, JSON.stringify({
    schemaVersion: 1,
    runId: "GAR-tools",
    repositoryRoots: [{ id: "project", path: repo }],
    artifacts: [{ id: "validation", path: join(artifacts, "validation.md") }],
    verifiers: [{ id: "node-version", command: process.execPath, args: ["--version"], cwdRootId: "project", timeoutMs: 5_000 }],
    capabilities,
  }));
  const tools = new Map<string, RegisteredTool>();
  registerAssessmentGateTools({ registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); } } as any, context);
  return { base, tools };
}

test("report-only registry contains no source, Git, GSD, package, deploy, or generic shell mutation tools", () => {
  const { base, tools } = setup();
  try {
    assert.deepEqual([...tools.keys()].sort(), [
      "assessment_artifact_read", "assessment_git_read", "assessment_list",
      "assessment_read", "assessment_search", "assessment_verify",
    ]);
    for (const forbidden of ["bash", "edit", "write", "git", "gsd", "npm", "deploy", "mcp"]) {
      assert.equal(tools.has(forbidden), false);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("repository and artifact reads are bounded to host-approved paths", async () => {
  const { base, tools } = setup();
  try {
    const read = await tools.get("assessment_read")!.execute("id", { rootId: "project", path: "source.ts" });
    assert.match(read.content[0]!.text, /marker = 'safe'/);
    await assert.rejects(
      () => tools.get("assessment_read")!.execute("id", { rootId: "project", path: "../outside.txt" }),
      /escapes the approved repository root/,
    );
    await assert.rejects(
      () => tools.get("assessment_read")!.execute("id", { rootId: "project", path: "escape-link" }),
      /resolves outside the approved repository root/,
    );
    await assert.rejects(
      () => tools.get("assessment_artifact_read")!.execute("id", { artifactId: "not-approved" }),
      /not approved/,
    );
    const artifact = await tools.get("assessment_artifact_read")!.execute("id", { artifactId: "validation" });
    assert.match(artifact.content[0]!.text, /validated evidence/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("capabilities are enforced again at tool execution and verifier argv is host-owned", async () => {
  const { base, tools } = setup([]);
  try {
    await assert.rejects(
      () => tools.get("assessment_read")!.execute("id", { rootId: "project", path: "source.ts" }),
      /repository.read was not approved/,
    );
    await assert.rejects(
      () => tools.get("assessment_verify")!.execute("id", { verifierId: "node-version" }),
      /process.verification was not approved/,
    );
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("approved verifier accepts only an opaque verifier ID", async () => {
  const { base, tools } = setup(["process.verification"]);
  try {
    await assert.rejects(
      () => tools.get("assessment_verify")!.execute("id", { verifierId: "rm -rf" }),
      /verifier is not approved/,
    );
    const response = await tools.get("assessment_verify")!.execute("id", { verifierId: "node-version" });
    assert.match(response.content[0]!.text, /^v\d+/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
