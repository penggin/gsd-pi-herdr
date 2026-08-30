import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getRequiredNpmPackageNames } = require("../lib/npm-release-packages.cjs");
const workflowFiles = readdirSync(join(root, ".github", "workflows"))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => join(".github", "workflows", name));

const activeDistributionFiles = [
  "AGENTS.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "Dockerfile",
  "docker/Dockerfile.ci-builder",
  "docker/Dockerfile.sandbox",
  "CONTRIBUTING.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ...workflowFiles,
  "docs/agents/issue-tracker.md",
  "docs/agents/triage-labels.md",
  "docs/dev/ci-cd-pipeline.md",
  "docs/user-docs/getting-started.md",
  "docs/user-docs/multi-repo-workspace.md",
  "docs/user-docs/node-lts-macos.md",
  "docs/user-docs/switching-between-gsd-tools.md",
  "docs/user-docs/troubleshooting.md",
  "docs/zh-CN/user-docs/getting-started.md",
  "docs/zh-CN/user-docs/node-lts-macos.md",
  "docs/zh-CN/user-docs/troubleshooting.md",
  "gitbook/README.md",
  "gitbook/getting-started/installation.md",
  "gitbook/reference/troubleshooting.md",
  "mintlify-docs/docs.json",
  "mintlify-docs/getting-started.mdx",
  "mintlify-docs/guides/troubleshooting.mdx",
  "native/Cargo.toml",
  "native/npm/darwin-arm64/package.json",
  "native/npm/darwin-x64/package.json",
  "native/npm/linux-arm64-gnu/package.json",
  "native/npm/linux-x64-gnu/package.json",
  "native/npm/win32-x64-msvc/package.json",
  "scripts/install.js",
  "scripts/install/banner.js",
  "scripts/install/non-tty.js",
  "scripts/install/npm-global.js",
  "scripts/install/detect-existing.js",
  "scripts/lib/logo.cjs",
  "scripts/lib/npm-release-packages.cjs",
  "scripts/link-workspace-packages.cjs",
  "scripts/publish-engine-packages.sh",
  "scripts/publish-workspace-packages.sh",
  "scripts/verify-merge-needed.sh",
  "scripts/verify-merge.sh",
  "scripts/validate-pack.js",
  "scripts/release-issue-upgrade-comments.mjs",
  "scripts/verify-native-platform-packages.mjs",
  "src/logo.ts",
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
  "vscode-extension/README.md",
  "vscode-extension/package.json",
  "vscode-extension/src/chat-participant.ts",
  "vscode-extension/src/gsd-client.ts",
];

const forbiddenTargets = [
  "@opengsd/gsd-pi",
  "@opengsd%2fgsd-pi",
  "https://github.com/open-gsd/gsd-pi",
  "https://api.github.com/repos/open-gsd/gsd-pi",
  "https://raw.githubusercontent.com/open-gsd/gsd-pi",
  "ghcr.io/open-gsd/gsd-pi",
  "ghcr.io/open-gsd/gsd-ci-builder",
  "@opengsd/engine-",
  'repository(owner:"open-gsd",name:"gsd-pi")',
  "--owner open-gsd",
  "-R open-gsd/gsd-pi",
  "upstream/main",
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

test("release inventory contains only downstream-owned packages", () => {
  const names = getRequiredNpmPackageNames();
  assert.deepEqual(names, [
    "@penggin/gsd-pi-herdr-engine-darwin-arm64",
    "@penggin/gsd-pi-herdr-engine-darwin-x64",
    "@penggin/gsd-pi-herdr-engine-linux-arm64-gnu",
    "@penggin/gsd-pi-herdr-engine-linux-x64-gnu",
    "@penggin/gsd-pi-herdr-engine-win32-x64-msvc",
    "@penggin/gsd-pi-herdr",
  ]);
  assert.equal(names.every((name) => name.startsWith("@penggin/")), true);
});

test("inherited internal workspaces are private and cannot be published separately", () => {
  for (const relativePath of [
    "packages/contracts/package.json",
    "packages/daemon/package.json",
    "packages/mcp-server/package.json",
    "packages/rpc-client/package.json",
  ]) {
    const manifest = JSON.parse(readFileSync(join(root, relativePath), "utf8"));
    assert.equal(manifest.private, true, `${relativePath} must be private`);
    assert.equal("publishConfig" in manifest, false, `${relativePath} must not opt into publication`);
  }
});
