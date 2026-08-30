import { readFileSync } from "node:fs";
import { parseFrontmatter, type Skill } from "@gsd/pi-coding-agent";
import { getInstalledSkills } from "../skills.js";
import type { AssessmentGateDescriptor } from "./types.js";

export interface InstalledAssessmentGate extends AssessmentGateDescriptor {
  body: string;
  skill: Skill;
}

function toGate(skill: Skill): InstalledAssessmentGate | undefined {
  if (skill.gsd?.kind !== "assessment-gate") return undefined;
  let body = "";
  let gateVersion: string | undefined;
  const diagnostics = [...(skill.gsdDiagnostics ?? [])];
  try {
    const parsed = parseFrontmatter<Record<string, unknown>>(readFileSync(skill.filePath, "utf8"));
    body = parsed.body.trim();
    gateVersion = typeof parsed.frontmatter.version === "string"
      ? parsed.frontmatter.version.trim() || undefined
      : typeof parsed.frontmatter.version === "number"
        ? String(parsed.frontmatter.version)
        : undefined;
  } catch (error) {
    diagnostics.push(`gate body is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    gateId: skill.name,
    gateVersion,
    description: skill.description,
    filePath: skill.filePath,
    source: skill.source,
    invocation: skill.gsd.invocation === "suggest" ? "suggest" : "manual",
    lifecycle: skill.gsd.lifecycle,
    capabilities: skill.gsd.capabilities,
    revisionBinding: skill.gsd.revisionBinding,
    resultSchema: "gsd.findings/v1",
    effect: "report-only",
    diagnostics,
    healthy: !skill.gsdMetadataFatal && body.length > 0,
    body,
    skill,
  };
}

export function listAssessmentGates(skills?: Skill[]): InstalledAssessmentGate[] {
  return getInstalledSkills(skills)
    .flatMap((skill) => toGate(skill) ?? [])
    .sort((left, right) => left.gateId.localeCompare(right.gateId));
}

export function findAssessmentGate(gateId: string, skills?: Skill[]): InstalledAssessmentGate | undefined {
  const normalized = gateId.trim().toLowerCase();
  return listAssessmentGates(skills).find((gate) => gate.gateId.toLowerCase() === normalized);
}

export function listSuggestibleAssessmentGates(skills?: Skill[]): InstalledAssessmentGate[] {
  return listAssessmentGates(skills).filter((gate) => gate.healthy && gate.invocation === "suggest");
}
