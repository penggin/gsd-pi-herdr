import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { AgentConfig } from "../../subagent/agents.js";
import { runRestrictedSubagent, type RestrictedSubagentResult } from "../../subagent/index.js";
import { atomicWriteSync } from "../atomic-write.js";
import { ensureDbOpen } from "../bootstrap/dynamic-tools.js";
import { getDb } from "../db/engine.js";
import { redactAssessmentSecrets, parseAssessmentFindingsJson } from "./findings-schema.js";
import { writeAssessmentRunProjection } from "./projection.js";
import {
  confirmGateSourceIntegrity,
  preparePostValidationBinding,
  preparePreMilestoneBinding,
  type GateSourceBinding,
} from "./revision-binding.js";
import {
  cancelAssessmentRun,
  createAssessmentRun,
  getAssessmentRun,
  markAssessmentRunning,
  settleAssessmentRun,
} from "./store.js";
import { ASSESSMENT_CONTEXT_ENV, ASSESSMENT_TOOL_NAMES } from "./tool-profile.js";
import type { InstalledAssessmentGate } from "./registry.js";
import type { AssessmentRun, EvidenceRef } from "./types.js";

export interface ApprovedVerifier {
  id: string;
  command: string;
  args: string[];
  cwdRootId: string;
  timeoutMs: number;
}

export interface ExecuteAssessmentGateInput {
  basePath: string;
  gate: InstalledAssessmentGate;
  lifecycle: "pre-milestone" | "post-validation";
  scopeText: string;
  milestoneId?: string;
  sliceId?: string;
  invocationReason: string;
  approval: { approved: true; approvedAt: string; method: "interactive" | "explicit-command" };
  model?: string;
  provider?: string;
  targetUrl?: string;
  verifiers?: ApprovedVerifier[];
  executeChild?: typeof runRestrictedSubagent;
}

const activeRuns = new Map<string, AbortController>();

function projectId(): string | undefined {
  const row = getDb().prepare("SELECT project_id FROM project_authority WHERE singleton = 1").get();
  return typeof row?.project_id === "string" ? row.project_id : undefined;
}

function approvedArtifacts(milestoneId: string | undefined): Array<{ id: string; path: string }> {
  if (!milestoneId) return [];
  const row = getDb().prepare(`
    SELECT result.output_json
    FROM workflow_domain_events event
    JOIN workflow_attempt_results result
      ON result.result_id = json_extract(event.payload_json, '$.resultId')
     AND result.project_id = event.project_id
    WHERE event.event_type = 'milestone.validation.recorded'
      AND event.entity_id = :milestone_id
    ORDER BY event.project_revision DESC, event.event_index DESC LIMIT 1
  `).get({ ":milestone_id": milestoneId });
  if (!row || typeof row.output_json !== "string") return [];
  try {
    const output = JSON.parse(row.output_json) as Record<string, unknown>;
    const path = output.validationPath;
    return typeof path === "string" && existsSync(path) ? [{ id: "current-validation", path }] : [];
  } catch {
    return [];
  }
}

function toolNames(gate: InstalledAssessmentGate): string[] {
  const names: string[] = [];
  if (gate.capabilities.includes("repository.read")) {
    names.push("assessment_read", "assessment_list", "assessment_search", "assessment_git_read");
  }
  if (gate.capabilities.includes("artifacts.read")) names.push("assessment_artifact_read");
  if (gate.capabilities.includes("process.verification")) names.push("assessment_verify");
  return names.filter((name) => ASSESSMENT_TOOL_NAMES.includes(name as typeof ASSESSMENT_TOOL_NAMES[number]));
}

function extensionEntry(): string {
  const js = fileURLToPath(new URL("../index.js", import.meta.url));
  if (existsSync(js)) return js;
  return fileURLToPath(new URL("../index.ts", import.meta.url));
}

function assessmentPrompt(input: ExecuteAssessmentGateInput, run: AssessmentRun, binding: GateSourceBinding, retry?: string): string {
  return [
    "You are a fresh, isolated GSD Assessment Gate agent.",
    "GSD exclusively owns projects, milestones, tasks, attempts, plans, validation, remediation, Git lifecycle, shipping, and state.",
    "You are report-only. You must not modify source, Git, GSD state, dependencies, accounts, deployments, or external services.",
    "Use only the capability-filtered assessment_* tools exposed by the host.",
    "Return exactly one JSON object and no markdown fence or prose.",
    "",
    `Gate: ${input.gate.gateId}`,
    `Description: ${input.gate.description}`,
    `Lifecycle: ${input.lifecycle}`,
    `Assessment scope: ${input.scopeText}`,
    `Approved repository root IDs: ${binding.targets.map((target) => target.id).join(", ") || "none"}`,
    `Approved artifact IDs: ${approvedArtifacts(input.milestoneId).map((artifact) => artifact.id).join(", ") || "none"}`,
    `Approved verifier IDs: ${(input.verifiers ?? []).map((verifier) => verifier.id).join(", ") || "none"}`,
    ...(binding.testedSourceRevision ? [`Tested source revision: ${binding.testedSourceRevision}`] : []),
    ...(binding.inputDigest ? [`Input digest: ${binding.inputDigest}`] : []),
    `Required schema: gsd.findings/v1`,
    "Every actionable finding (severity critical/high/medium/low) requires at least one concrete evidence reference.",
    "Do not include credentials, tokens, secrets, or unredacted sensitive values.",
    "",
    "Gate instructions:",
    input.gate.body,
    "",
    "Required JSON identity fields:",
    JSON.stringify({
      schemaVersion: "gsd.findings/v1",
      runId: run.runId,
      gateId: input.gate.gateId,
      lifecycle: input.lifecycle,
      ...(binding.testedSourceRevision ? { testedSourceRevision: binding.testedSourceRevision } : {}),
      ...(binding.inputDigest ? { inputDigest: binding.inputDigest } : {}),
    }),
    ...(retry ? ["", "Your previous output failed schema validation. Correct it once using these diagnostics:", retry] : []),
  ].join("\n");
}

function diagnosticPath(basePath: string, runId: string): string {
  return join(basePath, ".gsd", "assessments", "diagnostics", `${runId}.txt`);
}

function saveDiagnostic(basePath: string, runId: string, output: string, errors: string[]): string {
  const path = diagnosticPath(basePath, runId);
  const bounded = redactAssessmentSecrets(output).slice(0, 128 * 1024);
  atomicWriteSync(path, `${errors.join("\n")}\n\n--- bounded raw output ---\n${bounded}\n`, "utf8");
  return path;
}

function evidenceRefs(findings: AssessmentRun["findings"]): EvidenceRef[] {
  return findings.flatMap((finding) => finding.evidence);
}

async function executeGateRun(
  input: ExecuteAssessmentGateInput,
  run: AssessmentRun,
  binding: GateSourceBinding,
  contextPath: string,
  controller: AbortController,
): Promise<AssessmentRun> {
  const executeChild = input.executeChild ?? runRestrictedSubagent;
  const agent: AgentConfig = {
    name: `assessment-${input.gate.gateId}`,
    description: input.gate.description,
    tools: toolNames(input.gate),
    systemPrompt: "The host prompt defines the complete report-only Assessment Gate contract.",
    source: "project",
    filePath: input.gate.filePath,
  };
  markAssessmentRunning(run.runId);
  let last: RestrictedSubagentResult | undefined;
  let validationErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await executeChild({
      defaultCwd: input.basePath,
      agent,
      task: assessmentPrompt(input, run, binding, attempt === 1 ? validationErrors.join("; ") : undefined),
      model: input.model,
      signal: controller.signal,
      env: { [ASSESSMENT_CONTEXT_ENV]: contextPath },
      extensionPaths: [extensionEntry()],
    });
    if (controller.signal.aborted) {
      return cancelAssessmentRun(run.runId)!;
    }
    const integrity = confirmGateSourceIntegrity(input.basePath, binding);
    if (!integrity.ok) {
      const violation = `source changed during report-only assessment${integrity.currentRevision ? ` (${integrity.currentRevision})` : ""}`;
      const settled = settleAssessmentRun({
        runId: run.runId,
        status: "policy-violation",
        verdict: "inconclusive",
        summary: "Assessment invalidated because source integrity changed during execution.",
        failureReason: integrity.error ?? violation,
        sourceDriftPaths: integrity.paths,
        policyViolations: [violation],
      });
      writeAssessmentRunProjection(input.basePath, settled);
      return getAssessmentRun(run.runId)!;
    }
    if (last.exitCode !== 0) {
      const settled = settleAssessmentRun({
        runId: run.runId,
        status: "failed",
        verdict: "inconclusive",
        summary: "Assessment agent failed before producing a valid report.",
        failureReason: redactAssessmentSecrets(last.errorMessage || last.stderr || `child exited ${last.exitCode}`),
      });
      writeAssessmentRunProjection(input.basePath, settled);
      return getAssessmentRun(run.runId)!;
    }
    const parsed = parseAssessmentFindingsJson(last.output, {
      runId: run.runId,
      gateId: input.gate.gateId,
      lifecycle: input.lifecycle,
      testedSourceRevision: binding.testedSourceRevision,
      inputDigest: binding.inputDigest,
    });
    if (parsed.ok) {
      const settled = settleAssessmentRun({
        runId: run.runId,
        status: "completed",
        verdict: parsed.document.verdict,
        summary: parsed.document.summary,
        findings: parsed.document.findings,
        evidenceRefs: evidenceRefs(parsed.document.findings),
      });
      writeAssessmentRunProjection(input.basePath, settled);
      return getAssessmentRun(run.runId)!;
    }
    validationErrors = parsed.errors;
  }
  const rawDiagnosticRef = saveDiagnostic(input.basePath, run.runId, last?.output ?? "", validationErrors);
  const settled = settleAssessmentRun({
    runId: run.runId,
    status: "inconclusive",
    verdict: "inconclusive",
    summary: "Assessment output failed structured validation twice.",
    failureReason: validationErrors.join("; "),
    rawDiagnosticRef,
  });
  writeAssessmentRunProjection(input.basePath, settled);
  return getAssessmentRun(run.runId)!;
}

export async function startAssessmentGate(input: ExecuteAssessmentGateInput): Promise<{
  run: AssessmentRun;
  completion: Promise<AssessmentRun>;
}> {
  if (!input.gate.healthy) throw new Error(`assessment gate ${input.gate.gateId} has invalid metadata`);
  if (!input.gate.lifecycle.includes(input.lifecycle)) {
    throw new Error(`assessment gate ${input.gate.gateId} is not allowed at ${input.lifecycle}`);
  }
  if (input.gate.capabilities.includes("browser.inspect")) {
    throw new Error("browser.inspect assessment isolation is not available in v1; the gate was not started");
  }
  if (input.gate.capabilities.includes("process.verification") && !(input.verifiers?.length)) {
    throw new Error("process.verification requires at least one host-approved verifier");
  }
  if (!await ensureDbOpen(input.basePath)) throw new Error("GSD database is unavailable");
  const binding = input.lifecycle === "post-validation"
    ? preparePostValidationBinding(input.basePath, input.milestoneId ?? "")
    : preparePreMilestoneBinding(input.basePath, input.scopeText);
  const run = createAssessmentRun({
    gateId: input.gate.gateId,
    gateVersion: input.gate.gateVersion,
    scope: { projectId: projectId(), milestoneId: input.milestoneId, sliceId: input.sliceId },
    lifecycle: input.lifecycle,
    effect: "report-only",
    testedSourceRevision: binding.testedSourceRevision,
    inputDigest: binding.inputDigest,
    repositoryRevision: binding.repositoryRevision,
    toolProfile: input.gate.capabilities,
    blockedCapabilities: ["source.write", "git.write", "gsd.write", "shell.arbitrary", "deploy", "external.mutate"],
    targetUrl: input.targetUrl,
    invocationReason: input.invocationReason,
    approval: input.approval,
    model: input.model,
    provider: input.provider,
    sourceSnapshot: binding.snapshot,
  });
  const runtimeDir = join(input.basePath, ".gsd", "runtime", "assessment-gates", run.runId);
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const contextPath = join(runtimeDir, "context.json");
  writeFileSync(contextPath, JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    repositoryRoots: binding.targets.map((target) => ({ id: target.id, path: target.cwd })),
    artifacts: approvedArtifacts(input.milestoneId),
    verifiers: input.verifiers ?? [],
    capabilities: input.gate.capabilities,
  }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  const controller = new AbortController();
  activeRuns.set(run.runId, controller);
  const completion = executeGateRun(input, run, binding, contextPath, controller)
    .catch((error) => {
      const current = getAssessmentRun(run.runId);
      if (current && ["pending", "running"].includes(current.status)) {
        const settled = settleAssessmentRun({
          runId: run.runId,
          status: controller.signal.aborted ? "cancelled" : "failed",
          verdict: "inconclusive",
          summary: controller.signal.aborted
            ? "Assessment cancelled by the user."
            : "Assessment failed before producing a valid report.",
          failureReason: redactAssessmentSecrets(error instanceof Error ? error.message : String(error)),
        });
        writeAssessmentRunProjection(input.basePath, settled);
      }
      return getAssessmentRun(run.runId)!;
    })
    .finally(() => {
      activeRuns.delete(run.runId);
      rmSync(runtimeDir, { recursive: true, force: true });
    });
  return { run, completion };
}

export function requestAssessmentCancellation(runId: string): boolean {
  const controller = activeRuns.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}
