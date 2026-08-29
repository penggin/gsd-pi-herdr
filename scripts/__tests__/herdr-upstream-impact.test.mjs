import assert from "node:assert/strict";
import test from "node:test";

import { classifyPaths, parseNameStatus, renderImpactMarkdown } from "../herdr-integration/upstream-impact.mjs";

test("classifies upstream changes into deterministic Herdr risk and gates", () => {
  const changes = parseNameStatus([
    "M\tsrc/resources/extensions/subagent/index.ts",
    "R100\tdocs/old.md\tdocs/new.md",
    "M\tpackage.json",
  ].join("\n"));
  assert.deepEqual(changes[1], { status: "R100", path: "docs/new.md", previousPath: "docs/old.md" });
  const impact = classifyPaths(changes);
  assert.equal(impact.risk, "critical");
  assert.deepEqual(impact.categories.map((item) => item.id), ["subagent-runtime", "packaging", "documentation"]);
  assert.ok(impact.recommendedGates.includes("pnpm run test:herdr-integration"));
  assert.ok(impact.recommendedGates.includes("pnpm run validate-pack"));
});

test("renders a reviewable upstream impact summary", () => {
  const markdown = renderImpactMarkdown({
    base: { ref: "origin/main", commit: "a".repeat(40) },
    head: { ref: "HEAD", commit: "b".repeat(40) },
    lineageVerified: true,
    commitCount: 2,
    fileCount: 1,
    risk: "high",
    requiresHerdrParity: true,
    categories: [{ id: "packaging", risk: "high", files: ["package.json"] }],
    changes: [{ status: "M", path: "package.json" }],
    recommendedGates: ["pnpm run validate-pack"],
  });
  assert.match(markdown, /Lineage verified: yes/);
  assert.match(markdown, /Herdr parity required: yes/);
  assert.match(markdown, /pnpm run validate-pack/);
  assert.match(markdown, /`M` `package.json`/);
});
