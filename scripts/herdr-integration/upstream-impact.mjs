import { relative, resolve } from "node:path";

import { git, isMain, parseArgs, repositoryRoot, resolveGitRef, run, writeJsonAtomic } from "./shared.mjs";

const IMPACT_RULES = [
  {
    id: "subagent-runtime",
    risk: "critical",
    matches: (path) => path.startsWith("src/resources/extensions/subagent/") || path.startsWith("src/resources/extensions/cmux/"),
    gates: ["pnpm run typecheck:extensions", "pnpm run test:changed:src", "pnpm run test:herdr-integration"],
  },
  {
    id: "extension-lifecycle",
    risk: "high",
    matches: (path) => path === "src/loader.ts" || path.startsWith("src/resources/extensions/shared/") || path.startsWith("src/resources/extensions/herdr/"),
    gates: ["pnpm run typecheck:extensions", "pnpm run test:changed:src", "pnpm run test:herdr-integration"],
  },
  {
    id: "process-launch",
    risk: "high",
    matches: (path) => /(^|\/)(launch|process|session|fork|isolation|run-store)/i.test(path),
    gates: ["pnpm run test:changed:src", "pnpm run test:herdr-integration"],
  },
  {
    id: "packaging",
    risk: "high",
    matches: (path) => path === "package.json" || path === "pnpm-lock.yaml" || path.startsWith("scripts/") || path.startsWith(".github/workflows/"),
    gates: ["pnpm run build:core", "pnpm run validate-pack"],
  },
  {
    id: "preferences",
    risk: "medium",
    matches: (path) => /preferences|configuration|settings/i.test(path),
    gates: ["pnpm run typecheck:extensions", "pnpm run test:changed:src", "pnpm run test:herdr-integration"],
  },
  {
    id: "documentation",
    risk: "low",
    matches: (path) => path.startsWith("docs/") || path.endsWith("README.md"),
    gates: [],
  },
];

const RISK_ORDER = new Map([["none", 0], ["low", 1], ["medium", 2], ["high", 3], ["critical", 4]]);

export function classifyPaths(changes) {
  const categories = IMPACT_RULES.map((rule) => ({
    id: rule.id,
    risk: rule.risk,
    files: changes.filter((change) => rule.matches(change.path)).map((change) => change.path),
    gates: rule.gates,
  })).filter((category) => category.files.length > 0);
  const classified = new Set(categories.flatMap((category) => category.files));
  const unclassified = changes.map((change) => change.path).filter((path) => !classified.has(path));
  const risk = categories.reduce((highest, category) =>
    RISK_ORDER.get(category.risk) > RISK_ORDER.get(highest) ? category.risk : highest, changes.length ? "low" : "none");
  const recommendedGates = [...new Set(categories.flatMap((category) => category.gates))];
  return { risk, categories, unclassified, recommendedGates };
}

export function parseNameStatus(output) {
  return output.split("\n").filter(Boolean).map((line) => {
    const fields = line.split("\t");
    const status = fields[0];
    const path = status.startsWith("R") || status.startsWith("C") ? fields[2] : fields[1];
    return { status, path, ...(fields.length > 2 ? { previousPath: fields[1] } : {}) };
  });
}

export function buildImpactReport({ cwd = repositoryRoot, baseRef, headRef } = {}) {
  const base = resolveGitRef([baseRef, process.env.HERDR_UPSTREAM_BASE_REF, "upstream-main", "origin/upstream-main", "main"], { cwd });
  const head = resolveGitRef([headRef, process.env.HERDR_UPSTREAM_HEAD_REF, "upstream/main"], { cwd });
  const lineageVerified = run("git", ["merge-base", "--is-ancestor", base.commit, head.commit], { cwd, allowFailure: true }).status === 0;
  const changes = parseNameStatus(git(["diff", "--name-status", "--find-renames", base.commit, head.commit], { cwd }));
  const commits = git(["log", "--format=%H%x09%cI%x09%s", `${base.commit}..${head.commit}`], { cwd })
    .split("\n").filter(Boolean).map((line) => {
      const [commit, committedAt, ...subject] = line.split("\t");
      return { commit, committedAt, subject: subject.join("\t") };
    });
  const impact = classifyPaths(changes);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: relative(process.cwd(), resolve(cwd)) || ".",
    base,
    head,
    lineageVerified,
    commitCount: commits.length,
    fileCount: changes.length,
    changes,
    commits,
    ...impact,
    requiresHerdrParity: impact.categories.some((category) => ["subagent-runtime", "extension-lifecycle", "process-launch", "packaging", "preferences"].includes(category.id)),
  };
}

export function renderImpactMarkdown(report) {
  const lines = [
    "# GSD upstream impact report",
    "",
    `- Base: \`${report.base.ref}\` (\`${report.base.commit}\`)`,
    `- Head: \`${report.head.ref}\` (\`${report.head.commit}\`)`,
    `- Lineage verified: ${report.lineageVerified ? "yes" : "no"}`,
    `- Commits/files: ${report.commitCount}/${report.fileCount}`,
    `- Risk: **${report.risk}**`,
    `- Herdr parity required: ${report.requiresHerdrParity ? "yes" : "no"}`,
    "",
    "## Impact categories",
    "",
  ];
  if (report.categories.length === 0) lines.push("No classified changes.");
  for (const category of report.categories) lines.push(`- **${category.id}** (${category.risk}): ${category.files.length} file(s)`);
  lines.push("", "## Changed files", "");
  if (report.changes.length === 0) lines.push("No changed files.");
  for (const change of report.changes.slice(0, 100)) lines.push(`- \`${change.status}\` \`${change.path}\``);
  if (report.changes.length > 100) lines.push(`- … ${report.changes.length - 100} more (see JSON artifact)`);
  lines.push("", "## Recommended gates", "");
  if (report.recommendedGates.length === 0) lines.push("No focused downstream gates were selected.");
  for (const gate of report.recommendedGates) lines.push(`- \`${gate}\``);
  return `${lines.join("\n")}\n`;
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = buildImpactReport({ baseRef: args.base, headRef: args.head });
    if (args.output) writeJsonAtomic(args.output, report);
    if (args.markdown) process.stdout.write(renderImpactMarkdown(report));
    else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.lineageVerified) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`[herdr-upstream-impact] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
