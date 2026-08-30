import type { ExtensionCommandContext } from "@gsd/pi-coding-agent";
import { ensureDbOpen } from "./bootstrap/dynamic-tools.js";
import { findAssessmentGate, listAssessmentGates } from "./assessment-gates/registry.js";
import {
  captureCurrentAssessmentSourceRevision,
  diagnoseCurrentAssessmentSourceDrift,
} from "./assessment-gates/revision-binding.js";
import { requestAssessmentCancellation, startAssessmentGate } from "./assessment-gates/runner.js";
import {
  cancelAssessmentRun,
  getAssessmentRun,
  listAssessmentRuns,
  markAssessmentStale,
  recordGateRecommendationDisposition,
} from "./assessment-gates/store.js";
import { writeAssessmentRunProjection } from "./assessment-gates/projection.js";
import type { AssessmentRun } from "./assessment-gates/types.js";
import { projectRoot } from "./commands/context.js";

function statusLine(run: AssessmentRun): string {
  const binding = run.testedSourceRevision ?? run.inputDigest ?? "unbound";
  return `${run.runId}  ${run.status}  ${run.gateId}  ${run.lifecycle}  ${binding}`;
}

function statusDetails(run: AssessmentRun): string {
  return [
    statusLine(run),
    `Gate version: ${run.gateVersion ?? "not declared"}`,
    `Verdict: ${run.verdict ?? "pending"}`,
    `Scope: project=${run.scope.projectId ?? "-"} milestone=${run.scope.milestoneId ?? "-"} slice=${run.scope.sliceId ?? "-"}`,
    `Invocation: ${run.invocationReason || "not recorded"}`,
    `Approval: ${run.approval ? `${run.approval.method} at ${run.approval.approvedAt}` : "not recorded"}`,
    `Capabilities: ${run.toolProfile.join(", ") || "none"}`,
    `Blocked: ${run.blockedCapabilities.join(", ") || "none"}`,
    `Target: ${run.targetUrl ?? "none"}`,
    `Model/provider: ${run.model ?? "default"} / ${run.provider ?? "default"}`,
    `Started/completed: ${run.startedAt} / ${run.completedAt ?? "running"}`,
    `Evidence refs: ${run.evidenceRefs.length}`,
    `Repository revision: ${run.repositoryRevision ?? "not recorded"}`,
    `Stale: ${run.status === "stale" ? "yes" : "no"}`,
    `Policy violations: ${run.policyViolations.join("; ") || "none"}`,
    `Failure: ${run.failureReason ?? "none"}`,
  ].join("\n");
}

function parseRunArgs(args: string): { gateId?: string; milestoneId?: string; scopeText: string } {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const gateId = tokens.shift();
  let milestoneId: string | undefined;
  const scope: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === "--milestone") {
      milestoneId = tokens[++index];
    } else {
      scope.push(tokens[index]!);
    }
  }
  return { gateId, milestoneId, scopeText: scope.join(" ") };
}

function refreshStaleness(basePath: string, run: AssessmentRun): AssessmentRun {
  if (!["completed", "inconclusive"].includes(run.status) || !run.sourceSnapshot) return run;
  const snapshot = run.sourceSnapshot as { aggregateRevision?: unknown };
  if (typeof snapshot.aggregateRevision !== "string") return run;
  try {
    const current = captureCurrentAssessmentSourceRevision(basePath);
    if (current === snapshot.aggregateRevision) return run;
    const stale = markAssessmentStale(run.runId, diagnoseCurrentAssessmentSourceDrift(basePath));
    writeAssessmentRunProjection(basePath, stale);
    return getAssessmentRun(run.runId) ?? stale;
  } catch {
    return run;
  }
}

async function ensureGateDb(basePath: string): Promise<void> {
  if (!await ensureDbOpen(basePath)) throw new Error("GSD database is unavailable");
}

export async function handleGateCommand(
  args: string,
  ctx: ExtensionCommandContext,
  dependencies: { start?: typeof startAssessmentGate } = {},
): Promise<void> {
  const basePath = projectRoot();
  const [action = "list", ...rest] = args.trim().split(/\s+/).filter(Boolean);

  if (action === "list") {
    const gates = listAssessmentGates();
    if (gates.length === 0) {
      ctx.ui.notify("No Assessment Gates are installed. Ordinary Agent Skills are unaffected.", "info");
      return;
    }
    ctx.ui.notify([
      "Assessment Gates",
      "",
      ...gates.map((gate) => [
        `${gate.gateId}${gate.gateVersion ? `@${gate.gateVersion}` : ""} — ${gate.description}`,
        `  invocation=${gate.invocation} lifecycle=${gate.lifecycle.join(",")} effect=${gate.effect}`,
        `  capabilities=${gate.capabilities.join(",") || "none"} source=${gate.source}`,
        `  health=${gate.healthy ? "ok" : "invalid"}${gate.diagnostics.length ? ` (${gate.diagnostics.join("; ")})` : ""}`,
      ].join("\n")),
    ].join("\n"), "info");
    return;
  }

  if (action === "info") {
    const gate = findAssessmentGate(rest.join(" "));
    if (!gate) throw new Error(`Assessment Gate not found: ${rest.join(" ")}`);
    ctx.ui.notify([
      `${gate.gateId}${gate.gateVersion ? `@${gate.gateVersion}` : ""} — ${gate.description}`,
      `Invocation: ${gate.invocation}`,
      `Lifecycle: ${gate.lifecycle.join(", ")}`,
      `Effect: ${gate.effect}`,
      `Revision binding: ${gate.revisionBinding ?? "optional"}`,
      `Result schema: ${gate.resultSchema}`,
      `Capabilities: ${gate.capabilities.join(", ") || "none"}`,
      `Installed source: ${gate.source}`,
      `Path: ${gate.filePath}`,
      `Health: ${gate.healthy ? "ok" : gate.diagnostics.join("; ")}`,
    ].join("\n"), "info");
    return;
  }

  await ensureGateDb(basePath);

  if (action === "status") {
    const runId = rest[0];
    if (runId) {
      const run = getAssessmentRun(runId);
      ctx.ui.notify(run ? statusDetails(refreshStaleness(basePath, run)) : `Assessment run not found: ${runId}`, run ? "info" : "warning");
      return;
    }
    const runs = listAssessmentRuns().map((run) => refreshStaleness(basePath, run));
    ctx.ui.notify(runs.length ? runs.map(statusLine).join("\n") : "No Assessment Runs recorded.", "info");
    return;
  }

  if (action === "findings") {
    const runId = rest[0] ?? "";
    const found = getAssessmentRun(runId);
    if (!found) throw new Error(`Assessment run not found: ${runId}`);
    const run = refreshStaleness(basePath, found);
    const lines = [statusLine(run), "", run.summary || "No summary."];
    for (const finding of run.findings) {
      lines.push("", `[${finding.severity}] ${finding.id}: ${finding.title}`, finding.description);
      for (const evidence of finding.evidence) lines.push(`  - ${evidence.kind}: ${evidence.ref}${evidence.note ? ` — ${evidence.note}` : ""}`);
    }
    lines.push(
      "",
      "Findings do not change GSD lifecycle state. Choose an explicit GSD-owned follow-up:",
      "- capture finding or add a backlog item",
      "- open a debug investigation",
      "- create a rework brief or propose a remediation slice",
      "- dismiss with rationale or record accepted risk through the canonical decision flow",
      "Any source change must use the canonical remediation/reopen path, followed by verification and validation.",
    );
    ctx.ui.notify(lines.join("\n"), "info");
    return;
  }

  if (action === "cancel") {
    const runId = rest[0] ?? "";
    const signalled = requestAssessmentCancellation(runId);
    const run = signalled ? getAssessmentRun(runId) : cancelAssessmentRun(runId);
    ctx.ui.notify(run ? `Cancellation requested for ${runId}.` : `Assessment run not found: ${runId}`, run ? "info" : "warning");
    return;
  }

  if (action !== "run") {
    ctx.ui.notify("Usage: /gsd gate list|info <gate>|run <gate> [--milestone MID] [scope]|status [run-id]|findings <run-id>|cancel <run-id>", "warning");
    return;
  }

  const parsed = parseRunArgs(rest.join(" "));
  if (!parsed.gateId) throw new Error("Gate name is required");
  const gate = findAssessmentGate(parsed.gateId);
  if (!gate) throw new Error(`Assessment Gate not found: ${parsed.gateId}`);
  if (!gate.healthy) throw new Error(`Assessment Gate ${gate.gateId} is invalid: ${gate.diagnostics.join("; ")}`);
  const lifecycle = gate.lifecycle.length === 1
    ? gate.lifecycle[0]!
    : parsed.milestoneId
      ? "post-validation"
      : "pre-milestone";
  if (lifecycle === "post-validation" && !parsed.milestoneId) {
    throw new Error("post-validation Assessment Gates require --milestone <MID>");
  }
  const scopeId = parsed.milestoneId ?? "project:pre-milestone";
  const scopeText = parsed.scopeText || (parsed.milestoneId ? `Milestone ${parsed.milestoneId}` : "Current pre-milestone brief and repository context");
  const preview = [
    `Gate: ${gate.gateId}`,
    `Lifecycle: ${lifecycle}`,
    `Scope: ${scopeText}`,
    `Milestone: ${parsed.milestoneId ?? "not created"}`,
    `Capabilities: ${gate.capabilities.join(", ") || "none"}`,
    `External target: none`,
    `Effect: report-only (source/Git/GSD mutation tools are unavailable)`,
    `Cost/time: one fresh model run, plus one retry only if structured output is invalid`,
  ].join("\n");
  if (!ctx.hasUI) throw new Error("Assessment Gate execution requires interactive user approval");
  ctx.ui.notify(preview, "info");
  const choice = await ctx.ui.select("Run Assessment Gate?", ["Run now", "Skip", "Do not suggest again for this scope"]);
  if (choice !== "Run now") {
    recordGateRecommendationDisposition({
      gateId: gate.gateId,
      scopeId,
      status: choice === "Skip" ? "declined" : "suppressed",
      recordedAt: new Date().toISOString(),
    });
    ctx.ui.notify(`${preview}\n\nAssessment not started.`, "info");
    return;
  }
  recordGateRecommendationDisposition({ gateId: gate.gateId, scopeId, status: "accepted", recordedAt: new Date().toISOString() });
  const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
  const started = await (dependencies.start ?? startAssessmentGate)({
    basePath,
    gate,
    lifecycle,
    scopeText,
    milestoneId: parsed.milestoneId,
    invocationReason: "explicit /gsd gate run",
    approval: { approved: true, approvedAt: new Date().toISOString(), method: "interactive" },
    model,
    provider: ctx.model?.provider,
  });
  ctx.ui.notify(`${preview}\n\nStarted ${started.run.runId}. Use /gsd gate status ${started.run.runId}.`, "info");
  void started.completion.then((run) => {
    ctx.ui.notify(`Assessment ${run.runId}: ${run.status}${run.verdict ? ` (${run.verdict})` : ""}`, run.status === "completed" ? "success" : "warning");
  }).catch((error) => {
    ctx.ui.notify(`Assessment ${started.run.runId} failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  });
}
