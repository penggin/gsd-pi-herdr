import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const workflowFiles = readdirSync(join(root, ".github", "workflows"))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => join(".github", "workflows", name));

const activeDistributionFiles = [
  "package.json",
  "Dockerfile",
  "docker/Dockerfile.sandbox",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ...workflowFiles,
  "scripts/install.js",
  "scripts/install/non-tty.js",
  "scripts/install/npm-global.js",
  "scripts/install/detect-existing.js",
  "scripts/link-workspace-packages.cjs",
  "scripts/release-issue-upgrade-comments.mjs",
  "scripts/verify-native-platform-packages.mjs",
  "src/distribution.ts",
  "src/resources/shared/distribution.ts",
  "src/loader.ts",
  "src/cli.ts",
  "src/update-check.ts",
  "src/update-cmd.ts",
  "src/web/update-service.ts",
  "src/resources/extensions/gsd/changelog.ts",
  "src/resources/extensions/gsd/commands-handlers.ts",
  "src/resources/extensions/gsd/bootstrap/system-context.ts",
  "src/resources/extensions/gsd/preferences.ts",
  "src/resources/extensions/gsd/forensics.ts",
  "src/resources/extensions/gsd/prompts/forensics.md",
  "src/resources/skills/github-workflows/references/gh/SKILL.md",
  "packages/contracts/package.json",
  "packages/daemon/package.json",
  "packages/mcp-server/package.json",
  "packages/rpc-client/package.json",
];

const forbiddenTargets = [
  "@opengsd/gsd-pi",
  "@opengsd%2fgsd-pi",
  "https://github.com/open-gsd/gsd-pi",
  "https://api.github.com/repos/open-gsd/gsd-pi",
  "https://raw.githubusercontent.com/open-gsd/gsd-pi",
  "ghcr.io/open-gsd/gsd-pi",
];

test("active distribution and automation paths never target the original gsd-pi project", () => {
  for (const relativePath of activeDistributionFiles) {
    const source = readFileSync(join(root, relativePath), "utf8");
    for (const forbidden of forbiddenTargets) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${relativePath} must not contain active original-project target ${forbidden}`,
      );
    }
  }
});

test("Herdr canary compares only downstream refs and never fetches an original-project remote", () => {
  const source = readFileSync(join(root, ".github", "workflows", "herdr-canary.yml"), "utf8");
  assert.doesNotMatch(source, /git\s+(?:remote|fetch).*open-gsd/i);
  assert.match(source, /origin\/main/);
});
