// validate-pack.js — Verify the npm tarball is installable before publishing.
//
// Usage: pnpm run validate-pack (or node scripts/validate-pack.js)
// Exit 0 = safe to publish, Exit 1 = broken package.

import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { getLinkablePackages } = require('./lib/workspace-manifest.cjs');

let tarball = null;
let installDir = null;
let npmCacheDir = null;
let npmUserConfig = null;
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function cleanNpmEnv(extra = {}) {
  const env = {
    ...process.env,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    GSD_SKIP_RTK_INSTALL: '1',
    NPM_CONFIG_AUDIT: 'false',
    npm_config_audit: 'false',
    NPM_CONFIG_FUND: 'false',
    npm_config_fund: 'false',
    NPM_CONFIG_LOGLEVEL: 'error',
    npm_config_loglevel: 'error',
    NPM_CONFIG_USERCONFIG: npmUserConfig,
    npm_config_userconfig: npmUserConfig,
    NPM_CONFIG_ALLOW_SCRIPTS: '',
    npm_config_allow_scripts: '',
    ...extra,
  };
  for (const key of Object.keys(env)) {
    if (!key.startsWith('npm_config_')) continue;
    const setting = key.slice('npm_config_'.length).replace(/_/g, '-');
    if (setting === 'verify-deps-before-run' || setting === 'auto-install-peers' || setting === '_jsr-registry') {
      delete env[key];
    }
  }
  return env;
}

function runNpm(args, options = {}) {
  return execFileSync(getNpmCommand(), args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: DEFAULT_MAX_BUFFER,
    env: cleanNpmEnv({
      npm_config_cache: npmCacheDir ?? process.env.npm_config_cache,
    }),
    ...options,
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveBundledDepPkgJson(packageRoot, nodeModulesRoot, dep) {
  const segments = dep.startsWith('@') ? dep.split('/') : [dep];
  const candidates = [
    join(packageRoot, 'node_modules', ...segments, 'package.json'),
    join(nodeModulesRoot, ...segments, 'package.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  try {
    return createRequire(join(packageRoot, 'package.json')).resolve(`${dep}/package.json`);
  } catch {
    return null;
  }
}

function resolveDependencyDir(packageRoot, nodeModulesRoot, dep) {
  const pkgJsonPath = resolveBundledDepPkgJson(packageRoot, nodeModulesRoot, dep);
  return pkgJsonPath ? dirname(pkgJsonPath) : null;
}

function seedGlobalDependencyFromLocal(globalRoot, globalNodeModules, localPackageRoot, localNodeModules, dep) {
  if (resolveBundledDepPkgJson(globalRoot, globalNodeModules, dep)) return true;
  const localDir = resolveDependencyDir(localPackageRoot, localNodeModules, dep);
  if (!localDir || !existsSync(join(localDir, 'package.json'))) return false;
  const segments = dep.startsWith('@') ? dep.split('/') : [dep];
  const target = join(globalRoot, 'node_modules', ...segments);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(localDir, target, { recursive: true, dereference: true });
  return true;
}

function findPackedWorkspaceProtocolLeaks(packedPaths) {
  const leaks = [];
  for (const packedPath of packedPaths) {
    if (!packedPath.endsWith('package.json')) continue;
    const localPath = join(ROOT, packedPath);
    if (!existsSync(localPath)) continue;
    const content = readFileSync(localPath, 'utf8');
    if (content.includes('workspace:')) leaks.push(packedPath);
  }
  return leaks;
}

function getPackagedWorkspacePackages() {
  const packagesDir = join(ROOT, 'packages');
  if (!existsSync(packagesDir)) return [];
  const packages = [];
  for (const dir of readdirSync(packagesDir)) {
    const packageDir = join(packagesDir, dir);
    if (!statSync(packageDir).isDirectory()) continue;
    const packageJsonPath = join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    packages.push({
      dir,
      packageName: pkg.name ?? dir,
      packageJsonPath,
    });
  }
  return packages.sort((a, b) => a.packageName.localeCompare(b.packageName));
}

try {
  npmCacheDir = mkdtempSync(join(tmpdir(), 'validate-pack-npm-cache-'));
  mkdirSync(npmCacheDir, { recursive: true });
  npmUserConfig = join(npmCacheDir, 'empty-npmrc');
  writeFileSync(npmUserConfig, '');

  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  function isInternalWorkspaceDep(dep) {
    return dep.startsWith('@gsd/') || dep.startsWith('@opengsd/') || dep.startsWith('@earendil-works/');
  }

  // --- Guard: no `workspace:` protocol in the published dependency fields ---
  // `npm publish` builds the registry manifest (packument) from package.json read
  // BEFORE the `prepack` hook runs, so a `prepack`-time rewrite/strip lands in the
  // TARBALL but NOT in the published metadata that consumers resolve against. Any
  // `workspace:` range left in dependencies/optionalDependencies/peerDependencies
  // therefore leaks to the registry and breaks `npm install` with EUNSUPPORTEDPROTOCOL.
  // Internal @gsd/@opengsd packages must NOT appear in these fields at all — they ship
  // under packages/*/dist and are symlinked at postinstall (link-workspace-packages.cjs).
  console.log('==> Checking for workspace: protocol leaks in published dependency fields...');
  const workspaceLeaks = [];
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [dep, range] of Object.entries(rootPkg[field] || {})) {
      if (String(range).startsWith('workspace:')) workspaceLeaks.push(`${field}.${dep}=${range}`);
    }
  }
  if (workspaceLeaks.length) {
    console.log('ERROR: root package.json has workspace: ranges that will leak to the published registry manifest:');
    for (const leak of workspaceLeaks) console.log(`    ${leak}`);
    console.log('    Remove internal workspace packages from these fields (they ship via files + postinstall link).');
    process.exit(1);
  }
  console.log('    No workspace: protocol leaks in published dependency fields.');

  // --- Guard: packaged workspace external dependencies must be declared on the root ---
  // Workspace packages are shipped inside the root tarball under
  // packages/*/dist and packages/*/bin; linkable packages are symlinked into
  // node_modules at postinstall (link-workspace-packages.cjs), and non-linkable
  // packaged CLIs can still be executed from their shipped package directories.
  // Their EXTERNAL (registry) deps must therefore be declared on the root package so
  // `npm install` and the installer's `npm install --ignore-scripts` repair
  // materialize them; shipped workspace packages then resolve those externals by
  // walking up to the root node_modules.
  console.log('==> Checking packaged workspace external dependency coverage on root...');
  const rootExternalDeps = new Set(Object.keys(rootPkg.dependencies || {}));
  const rootOptionalExternalDeps = new Set(Object.keys(rootPkg.optionalDependencies || {}));

  const missingExternal = new Map();
  const missingOptionalExternal = new Map();
  for (const ws of getPackagedWorkspacePackages()) {
    const pkg = JSON.parse(readFileSync(ws.packageJsonPath, 'utf8'));
    for (const [dep, version] of Object.entries(pkg.dependencies || {})) {
      if (isInternalWorkspaceDep(dep)) continue;
      if (!rootExternalDeps.has(dep)) {
        const entry = missingExternal.get(dep) ?? { version, packages: new Set() };
        entry.packages.add(ws.packageName);
        missingExternal.set(dep, entry);
      }
    }
    for (const [dep, version] of Object.entries(pkg.optionalDependencies || {})) {
      if (isInternalWorkspaceDep(dep)) continue;
      if (!rootExternalDeps.has(dep) && !rootOptionalExternalDeps.has(dep)) {
        const entry = missingOptionalExternal.get(dep) ?? { version, packages: new Set() };
        entry.packages.add(ws.packageName);
        missingOptionalExternal.set(dep, entry);
      }
    }
  }

  if (missingExternal.size > 0) {
    console.log('ERROR: Packaged workspace packages depend on externals missing from root dependencies:');
    for (const [dep, entry] of [...missingExternal.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`    ${dep}@${entry.version} (needed by ${[...entry.packages].sort().join(', ')})`);
    }
    console.log('    Add these to root package.json dependencies so installs resolve them at runtime.');
    process.exit(1);
  }
  if (missingOptionalExternal.size > 0) {
    console.log('ERROR: Packaged workspace packages have optional externals missing from root dependencies/optionalDependencies:');
    for (const [dep, entry] of [...missingOptionalExternal.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`    ${dep}@${entry.version} (optional for ${[...entry.packages].sort().join(', ')})`);
    }
    console.log('    Add these to root package.json optionalDependencies so installs preserve optional runtime features.');
    process.exit(1);
  }
  console.log('    Packaged workspace external dependency coverage is complete.');

  // --- Pack tarball ---
  // npm pack --ignore-scripts skips prepack; resolve workspace:* for publishable tarballs.
  execFileSync(process.execPath, [join(__dirname, 'prepack-resolve-workspace.cjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  console.log('==> Packing tarball...');
  const packOutput = runNpm(['pack', '--json', '--ignore-scripts']);
  const packEntries = JSON.parse(packOutput);
  const packEntry = Array.isArray(packEntries) ? packEntries[0] : null;
  if (!packEntry || typeof packEntry.filename !== 'string' || packEntry.filename.length === 0) {
    console.log('ERROR: npm pack returned no package metadata.');
    process.exit(1);
  }
  const tarballName = packEntry.filename;
  tarball = join(ROOT, tarballName);

  if (!existsSync(tarball)) {
    console.log('ERROR: npm pack produced no tarball');
    process.exit(1);
  }

  const stats = statSync(tarball);
  console.log(`==> Tarball: ${tarballName} (${formatBytes(stats.size)} compressed)`);

  // --- Guard: fail loudly on tarball bloat ---
  // The npm->pnpm migration repeatedly shipped a 537MB / 85k-file tarball because
  // npm's bundle walker followed the pnpm virtual store (node_modules/.pnpm) and the
  // nested packages/*/node_modules trees. These assertions turn that silent bloat
  // into a hard failure before publish. Thresholds sit well above the legitimate
  // bundled payload (~15k files / ~220MB unpacked) with headroom for growth.
  const MAX_ENTRY_COUNT = 30000;
  const MAX_UNPACKED_BYTES = 350 * 1024 * 1024;
  const packMetadataErrors = [];
  if (!Number.isFinite(packEntry.entryCount)) {
    packMetadataErrors.push('missing numeric entryCount');
  }
  if (!Number.isFinite(packEntry.unpackedSize)) {
    packMetadataErrors.push('missing numeric unpackedSize');
  }
  if (!Array.isArray(packEntry.files)) {
    packMetadataErrors.push('missing files[] metadata');
  } else if (packEntry.files.some((entry) => typeof entry?.path !== 'string' || entry.path.length === 0)) {
    packMetadataErrors.push('files[] entries missing path metadata');
  }
  if (packMetadataErrors.length) {
    console.log('ERROR: npm pack metadata missing fields required by the tarball bloat guard:');
    for (const e of packMetadataErrors) console.log(`    ${e}`);
    process.exit(1);
  }
  const entryCount = packEntry.entryCount;
  const unpackedSize = packEntry.unpackedSize;
  const allPackedPaths = packEntry.files.map((entry) => entry.path);
  const pnpmStorePaths = allPackedPaths.filter((p) => p.startsWith('node_modules/.pnpm/'));
  const nestedNmPaths = allPackedPaths.filter((p) => /^packages\/[^/]+\/node_modules\//.test(p));
  const workspaceProtocolLeaks = findPackedWorkspaceProtocolLeaks(allPackedPaths);
  const bloatErrors = [];
  if (entryCount > MAX_ENTRY_COUNT) {
    bloatErrors.push(`entry count ${entryCount} exceeds ${MAX_ENTRY_COUNT} (pnpm store or nested node_modules likely leaked)`);
  }
  if (unpackedSize > MAX_UNPACKED_BYTES) {
    bloatErrors.push(`unpacked size ${formatBytes(unpackedSize)} exceeds ${formatBytes(MAX_UNPACKED_BYTES)}`);
  }
  if (pnpmStorePaths.length > 500) {
    bloatErrors.push(`${pnpmStorePaths.length} node_modules/.pnpm/* entries packed (e.g. ${pnpmStorePaths[0]}) — bundled deps are dragging in the pnpm virtual store`);
  }
  if (nestedNmPaths.length > 0) {
    bloatErrors.push(`${nestedNmPaths.length} packages/*/node_modules/* entries packed (e.g. ${nestedNmPaths[0]}) — files[] is shipping workspace node_modules`);
  }
  if (workspaceProtocolLeaks.length > 0) {
    bloatErrors.push(`${workspaceProtocolLeaks.length} packed package.json file(s) still contain workspace: protocol ranges (e.g. ${workspaceProtocolLeaks[0]})`);
  }
  if (bloatErrors.length) {
    console.log('ERROR: Tarball guard tripped:');
    for (const e of bloatErrors) console.log(`    ${e}`);
    console.log('    See package.json "files" and workspace package outputs.');
    process.exit(1);
  }
  console.log(`    Size guard OK: ${entryCount} entries, ${formatBytes(unpackedSize)} unpacked, ${pnpmStorePaths.length} .pnpm entries.`);

  // npm install can consume/delete a cwd-local tarball; keep a temp copy for later smoke tests.
  const packedTarballPath = tarball;
  tarball = join(mkdtempSync(join(tmpdir(), 'validate-pack-tarball-')), tarballName);
  copyFileSync(packedTarballPath, tarball);
  rmSync(packedTarballPath, { force: true });

  execFileSync(process.execPath, [join(__dirname, 'postpack-restore-workspace.cjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  // --- Check critical files using npm pack metadata ---
  console.log('==> Checking critical files...');
  const packedFiles = new Set(packEntry.files.map((entry) => entry.path));

  const requiredFiles = [
    'dist/loader.js',
    'dist/herdr-release.json',
    'packages/pi-coding-agent/dist/index.js',
    'packages/pi-ai/bin/pi-ai.js',
    'packages/pi-ai/dist/cli.js',
    'packages/native/dist/file-identity/index.js',
    'packages/daemon/bin/gsd-daemon.js',
    'packages/daemon/dist/cli.js',
    'packages/rpc-client/dist/index.js',
    'packages/mcp-server/bin/gsd-mcp-server.js',
    'packages/mcp-server/dist/cli.js',
    'scripts/link-workspace-packages.cjs',
    'integrations/hermes/plugin.yaml',
    'integrations/herdr/compatibility.json',
    'integrations/herdr/plugin/herdr-plugin.toml',
    'dist/web/standalone/server.js',
  ];

  const retiredProductPrefixes = [
    'packages/cloud-mcp-gateway/',
    'packages/gsd-cloud/',
  ];

  let missing = false;
  for (const required of requiredFiles) {
    if (!packedFiles.has(required)) {
      console.log(`    MISSING: ${required}`);
      missing = true;
    }
  }

  if (missing) {
    console.log('ERROR: Critical files missing from tarball.');
    process.exit(1);
  }
  for (const prefix of retiredProductPrefixes) {
    if ([...packedFiles].some((file) => file.startsWith(prefix))) {
      console.log(`ERROR: Retired product payload is still packed: ${prefix}`);
      process.exit(1);
    }
  }
  console.log('    Critical files present.');

  // --- Install test ---
  console.log('==> Testing install in isolated directory...');
  installDir = mkdtempSync(join(tmpdir(), 'validate-pack-'));
  writeFileSync(join(installDir, 'package.json'), JSON.stringify({ name: 'test-install', version: '1.0.0', private: true }, null, 2));

  try {
    const installOutput = execFileSync(getNpmCommand(), ['install', tarball], {
      cwd: installDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: DEFAULT_MAX_BUFFER,
      env: cleanNpmEnv({
        npm_config_cache: npmCacheDir,
      }),
    });
    console.log(installOutput);
    console.log('==> Install succeeded.');
  } catch (err) {
    console.log('');
    console.log('ERROR: npm install of tarball failed.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    process.exit(1);
  }

  // --- Verify every linkable workspace package resolved correctly post-install ---
  // This catches the Windows-style failure where symlinkSync fails silently and
  // node_modules/@gsd/ is never populated, causing ERR_MODULE_NOT_FOUND at runtime.
  // Checks every package with `gsd.linkable: true` — not just a hand-picked subset —
  // so any future addition is automatically covered.
  console.log('==> Verifying workspace package resolution (every linkable package)...');
  const installedRoot = join(installDir, 'node_modules', ...rootPkg.name.split('/'));
  let resolutionFailed = false;
  for (const pkg of getLinkablePackages()) {
    const pkgPath = join(installedRoot, 'node_modules', pkg.scope, pkg.name);
    const fallbackPath = join(installedRoot, 'packages', pkg.dir);
    if (!existsSync(pkgPath)) {
      if (existsSync(fallbackPath)) {
        console.log(`    MISSING symlink/copy: node_modules/${pkg.scope}/${pkg.name} (packages/${pkg.dir} exists — postinstall may not have run)`);
      } else {
        console.log(`    MISSING: node_modules/${pkg.scope}/${pkg.name} (packages/${pkg.dir} also absent — package is broken)`);
      }
      resolutionFailed = true;
    }
  }
  if (resolutionFailed) {
    console.log('ERROR: Linkable workspace packages are not resolvable after install.');
    console.log('    This will cause ERR_MODULE_NOT_FOUND on first run (especially on Windows).');
    process.exit(1);
  }
  console.log(`    All ${getLinkablePackages().length} linkable packages are resolvable.`);

  // Internal extension code imports this public subpath directly. Resolving it
  // from the installed tarball catches both a missing exports-map entry and a
  // package-staging/linking mismatch before the release reaches users.
  console.log('==> Verifying packaged native file-identity subpath...');
  try {
    execFileSync(
      process.execPath,
      ['-e', "require.resolve('@gsd/native/file-identity')"],
      {
        cwd: installedRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        maxBuffer: DEFAULT_MAX_BUFFER,
      },
    );
    console.log('    @gsd/native/file-identity resolves from the installed tarball.');
  } catch (err) {
    console.log('ERROR: installed tarball cannot resolve @gsd/native/file-identity.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    process.exit(1);
  }

  const loaderPath = join(installedRoot, 'dist', 'loader.js');
  console.log('==> Verifying installed downstream/Herdr build identity...');
  try {
    const buildInfo = JSON.parse(execFileSync(process.execPath, [loaderPath, '--build-info'], {
      cwd: installDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      maxBuffer: DEFAULT_MAX_BUFFER,
    }));
    if (buildInfo.package !== rootPkg.name || buildInfo.herdrIntegration !== true || !buildInfo.releaseMetadata) {
      throw new Error(`unexpected build info: ${JSON.stringify(buildInfo)}`);
    }
    console.log(`    ${buildInfo.package} carries Herdr release metadata (${buildInfo.releaseMetadata.downstream.buildKind}).`);
  } catch (err) {
    console.log('ERROR: Installed tarball lacks valid downstream/Herdr build identity.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    console.log(err.message ?? err);
    process.exit(1);
  }

  // --- Verify the packaged standalone web host resolves its runtime deps ---
  // pnpm lays top-level deps down as symlinks into a `.pnpm/` store, and
  // `npm pack` silently drops symlinks — so the published standalone host can
  // lose its `next`/`react`/`react-dom` entries and crash on boot with
  // `Cannot find module 'next'` (#328). Resolving them from the installed
  // standalone dir turns that fatal, silent packaging gap into a hard publish
  // gate. (The staging step flattens the store; this proves it stuck.)
  console.log('==> Verifying packaged standalone web host resolves runtime deps...');
  const standaloneDir = join(installedRoot, 'dist', 'web', 'standalone');
  try {
    execFileSync(
      process.execPath,
      ['-e', "require.resolve('next'); require.resolve('react'); require.resolve('react-dom')"],
      {
        cwd: standaloneDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        maxBuffer: DEFAULT_MAX_BUFFER,
      },
    );
    console.log('    standalone host resolves next/react/react-dom.');
  } catch (err) {
    console.log('ERROR: packaged standalone web host cannot resolve next/react/react-dom after install.');
    console.log(`    Checked from: ${standaloneDir}`);
    console.log('    pnpm symlinks were likely dropped by npm pack — staging must flatten the .pnpm store.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    process.exit(1);
  }

  // --- Run the binary to confirm end-to-end resolution ---
  console.log('==> Running installed binary (gsd -v)...');
  const bundledWorkflowMcpCliPath = join(installedRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
  if (!existsSync(bundledWorkflowMcpCliPath)) {
    console.log('ERROR: Bundled workflow MCP CLI missing after install.');
    console.log(`    Expected: ${bundledWorkflowMcpCliPath}`);
    process.exit(1);
  }

  // The inherited MCP workspace is private and bundled into the downstream
  // root package. Validate its public API and stdio transport from the actual
  // installed root tarball rather than packing or publishing it separately.
  console.log('==> Verifying bundled MCP server import and handshake...');
  try {
    const publicApiScript = `
      import { Client } from "@modelcontextprotocol/sdk/client/index.js";
      import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
      import { createMcpServer } from "@opengsd/mcp-server";

      delete process.env.GSD_WORKFLOW_EXECUTORS_MODULE;
      delete process.env.GSD_WORKFLOW_WRITE_GATE_MODULE;
      const { server } = await createMcpServer({});
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "bundled-mcp-validator", version: "1.0.0" });
      try {
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        const { tools } = await client.listTools();
        if (!tools.some((tool) => tool.name === "gsd_execute")) {
          throw new Error("bundled MCP public API did not advertise gsd_execute");
        }
      } finally {
        await client.close();
        await server.close();
      }
    `;
    execFileSync(process.execPath, ['--input-type=module', '--eval', publicApiScript], {
      cwd: installedRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 30000,
      maxBuffer: DEFAULT_MAX_BUFFER,
    });

    const installedMcpManifestPath = join(installedRoot, 'node_modules', '@opengsd', 'mcp-server', 'package.json');
    const installedMcpManifest = JSON.parse(readFileSync(installedMcpManifestPath, 'utf8'));
    const mcpBinEntry = installedMcpManifest.bin?.['gsd-mcp-server'];
    if (typeof mcpBinEntry !== 'string') throw new Error('bundled MCP package has no gsd-mcp-server bin');
    const mcpBinPath = resolve(dirname(installedMcpManifestPath), mcpBinEntry);
    const handshakeScript = `
      import { Client } from "@modelcontextprotocol/sdk/client/index.js";
      import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [${JSON.stringify(mcpBinPath)}],
        cwd: ${JSON.stringify(installDir)},
        env: {
          GSD_CODING_AGENT_DIR: ${JSON.stringify(join(installDir, 'agent'))},
          GSD_HOME: ${JSON.stringify(join(installDir, '.gsd'))},
          GSD_MCP_CLIENT_MANAGED: "1",
          GSD_MCP_PROBE: "1",
          GSD_WORKFLOW_PROJECT_ROOT: ${JSON.stringify(installDir)},
        },
        stderr: "pipe",
      });
      const client = new Client({ name: "bundled-mcp-stdio-validator", version: "1.0.0" });
      try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        if (!tools.some((tool) => tool.name === "gsd_execute")) {
          throw new Error("bundled MCP stdio server did not advertise gsd_execute");
        }
      } finally {
        await client.close();
      }
    `;
    execFileSync(process.execPath, ['--input-type=module', '--eval', handshakeScript], {
      cwd: installedRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 30000,
      maxBuffer: DEFAULT_MAX_BUFFER,
    });
    console.log('    bundled MCP import and stdio handshake are valid.');
  } catch (err) {
    console.log('ERROR: Bundled MCP server validation failed after root tarball install.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    console.log(err.message ?? err);
    process.exit(1);
  }

  try {
    const versionOutput = execFileSync(process.execPath, [loaderPath, '-v'], {
      cwd: installDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      maxBuffer: DEFAULT_MAX_BUFFER,
    }).trim();
    console.log(`    gsd -v => ${versionOutput}`);
    if (!versionOutput.match(/^\d+\.\d+\.\d+/)) {
      console.log('ERROR: gsd -v returned unexpected output (expected a version string).');
      process.exit(1);
    }
  } catch (err) {
    console.log('ERROR: Running gsd -v failed after install.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    process.exit(1);
  }

  // --- Verify undici resolves for bundled pi-coding-agent (global install regression) ---
  console.log('==> Verifying undici resolves for pi-coding-agent/http-dispatcher...');
  const httpDispatcherPath = join(
    installedRoot,
    'node_modules',
    '@gsd',
    'pi-coding-agent',
    'dist',
    'core',
    'http-dispatcher.js',
  );
  try {
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify('file://' + httpDispatcherPath.replace(/\\/g, '/'))});`,
      ],
      {
        cwd: installDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        maxBuffer: DEFAULT_MAX_BUFFER,
      },
    );
    console.log('    pi-coding-agent/core/http-dispatcher resolves undici.');
  } catch (err) {
    console.log('ERROR: pi-coding-agent failed to resolve undici after install.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    process.exit(1);
  }

  // --- Verify pi-coding-agent re-exports resolve bundled @gsd/agent-core ---
  // Relative ../../../gsd-agent-core paths break after npm install (folder is @gsd/agent-core).
  console.log('==> Verifying pi-coding-agent @gsd/agent-core re-exports...');
  const lifecycleHooksPath = join(
    installedRoot,
    'node_modules',
    '@gsd',
    'pi-coding-agent',
    'dist',
    'core',
    'lifecycle-hooks.js',
  );
  try {
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify('file://' + lifecycleHooksPath.replace(/\\/g, '/'))});`,
      ],
      {
        cwd: installDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        maxBuffer: DEFAULT_MAX_BUFFER,
      },
    );
    console.log('    pi-coding-agent/core/lifecycle-hooks resolves @gsd/agent-core.');
  } catch (err) {
    console.log('ERROR: pi-coding-agent re-export failed to resolve @gsd/agent-core after install.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    process.exit(1);
  }

  // --- Verify installer CLI surface ---
  console.log('==> Verifying installer CLI...');
  const installScriptPath = join(installedRoot, 'scripts', 'install.js');
  const installDepsPath = join(installedRoot, 'scripts', 'install', 'deps.js');
  if (!existsSync(installDepsPath)) {
    console.log('ERROR: Modular installer deps missing after install.');
    console.log(`    Expected: ${installDepsPath}`);
    process.exit(1);
  }
  try {
    const helpOutput = execFileSync(process.execPath, [installScriptPath, '--help'], {
      cwd: installDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      maxBuffer: DEFAULT_MAX_BUFFER,
    });
    if (!helpOutput.includes('--yes')) {
      console.log('ERROR: install.js --help missing --yes flag documentation.');
      process.exit(1);
    }
    console.log('    install.js --help OK');
  } catch (err) {
    console.log('ERROR: install.js --help failed after install.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    process.exit(1);
  }

  // --- Verify packaged non-linkable CLI resolves its root-provided deps ---
  console.log('==> Verifying packaged daemon dependency resolution...');
  try {
    const daemonHelpOutput = execFileSync(process.execPath, [join(installedRoot, 'packages', 'daemon', 'bin', 'gsd-daemon.js'), '--help'], {
      cwd: installDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      maxBuffer: DEFAULT_MAX_BUFFER,
    });
    if (!daemonHelpOutput.includes('Usage: gsd-daemon')) {
      console.log('ERROR: gsd-daemon --help returned unexpected output.');
      process.exit(1);
    }
    console.log('    daemon package deps resolve.');
  } catch (err) {
    console.log('ERROR: packaged daemon dependency resolution failed after install.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    process.exit(1);
  }

  // --- Global install smoke (npx path: --ignore-scripts, then repair) ---
  console.log('==> Testing global install (--ignore-scripts, bundled deps + repair)...');
  const globalPrefix = mkdtempSync(join(tmpdir(), 'validate-pack-global-'));
  try {
    execFileSync(getNpmCommand(), ['install', '-g', tarball, '--ignore-scripts', '--prefix', globalPrefix], {
      cwd: installDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: DEFAULT_MAX_BUFFER,
      env: cleanNpmEnv({
        npm_config_cache: npmCacheDir,
      }),
    });
    const globalNodeModules = execFileSync(getNpmCommand(), ['root', '-g', '--prefix', globalPrefix], {
      cwd: installDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: DEFAULT_MAX_BUFFER,
      env: cleanNpmEnv({
        npm_config_cache: npmCacheDir,
      }),
    }).trim();
    const globalRoot = join(globalNodeModules, ...rootPkg.name.split('/'));
    const globalMcpBin = process.platform === 'win32'
      ? join(globalPrefix, 'gsd-mcp-server.cmd')
      : join(globalPrefix, 'bin', 'gsd-mcp-server');
    if (!existsSync(globalMcpBin)) {
      console.log('ERROR: Global downstream install did not expose gsd-mcp-server on its bin path.');
      console.log(`    Expected: ${globalMcpBin}`);
      process.exit(1);
    }

    // Workspace packages ship under packages/*/dist and are symlinked into
    // node_modules by the postinstall script, which `--ignore-scripts` skipped.
    // Run it explicitly to mirror what the real installer does first.
    const linkScript = join(globalRoot, 'scripts', 'link-workspace-packages.cjs');
    execFileSync(process.execPath, [linkScript], {
      cwd: globalRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      maxBuffer: DEFAULT_MAX_BUFFER,
    });
    // External (registry) deps are no longer bundled. In a real `--ignore-scripts`
    // install the installer's `npm install --ignore-scripts` repair materializes
    // them from the registry; here we seed them from the local tarball install
    // instead, which avoids OOM resolving the full dependency graph in the global tree.
    const localNodeModules = join(installDir, 'node_modules');
    for (const dep of Object.keys(rootPkg.dependencies || {})) {
      if (dep.startsWith('@gsd/') || dep.startsWith('@opengsd/') || dep.startsWith('@earendil-works/')) {
        continue;
      }
      seedGlobalDependencyFromLocal(globalRoot, globalNodeModules, installedRoot, localNodeModules, dep);
    }

    // After repair, the externals the @gsd packages need at runtime must resolve
    // from the global root node_modules (previously these were bundled).
    const requiredExternalDeps = [
      '@modelcontextprotocol/sdk',
      'minimatch',
      'picomatch',
      'proper-lockfile',
      'undici',
      'yaml',
      'openai',
    ];
    for (const dep of requiredExternalDeps) {
      if (!resolveBundledDepPkgJson(globalRoot, globalNodeModules, dep)) {
        console.log(`ERROR: Global install left ${dep} unresolved after repair.`);
        console.log(`    Checked nested and hoisted node_modules under ${globalRoot}`);
        process.exit(1);
      }
    }

    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify('file://' + join(globalRoot, 'node_modules', '@gsd', 'pi-coding-agent', 'dist', 'core', 'http-dispatcher.js').replace(/\\/g, '/'))});`,
      ],
      {
        cwd: globalPrefix,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        maxBuffer: DEFAULT_MAX_BUFFER,
      },
    );
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import('yaml'); await import('minimatch');`,
      ],
      {
        cwd: globalRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        maxBuffer: DEFAULT_MAX_BUFFER,
      },
    );
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify('file://' + join(globalRoot, 'node_modules', '@gsd', 'pi-ai', 'dist', 'providers', 'openai-responses.js').replace(/\\/g, '/'))});`,
      ],
      {
        cwd: globalPrefix,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        maxBuffer: DEFAULT_MAX_BUFFER,
      },
    );
    console.log('==> Verifying copied extension resolves hoisted externals...');
    const localYamlDir = join(globalRoot, 'node_modules', 'yaml');
    const hoistedYamlDir = join(globalNodeModules, 'yaml');
    if (existsSync(localYamlDir)) {
      if (!existsSync(hoistedYamlDir)) {
        cpSync(localYamlDir, hoistedYamlDir, { recursive: true, dereference: true });
      }
      rmSync(localYamlDir, { recursive: true, force: true });
    }
    const agentDir = join(globalPrefix, 'agent-home');
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          `const { initResources } = await import(${JSON.stringify(pathToFileURL(join(globalRoot, 'dist', 'resource-loader.js')).href)});`,
          `initResources(${JSON.stringify(agentDir)});`,
          `await import(${JSON.stringify(pathToFileURL(join(agentDir, 'extensions', 'gsd', 'commands', 'handlers', 'workflow.js')).href)});`,
        ].join('\n'),
      ],
      {
        cwd: globalRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        maxBuffer: DEFAULT_MAX_BUFFER,
      },
    );
    console.log('    Copied /gsd workflow handler resolves hoisted yaml.');
    console.log('    Global --ignore-scripts install exposes gsd-mcp-server and repair resolves externals and pi-ai/pi-coding-agent.');
  } catch (err) {
    console.log('ERROR: Global install smoke test failed.');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(err.stderr);
    process.exit(1);
  } finally {
    rmSync(globalPrefix, { recursive: true, force: true });
  }

  console.log('');
  console.log('Package is installable. Safe to publish.');
  process.exit(0);
} finally {
  try {
    execFileSync(process.execPath, [join(__dirname, 'postpack-restore-workspace.cjs')], {
      cwd: ROOT,
      stdio: 'ignore',
    });
  } catch {
    // postpack restore is best-effort when pack fails before npm postpack runs
  }
  if (installDir && existsSync(installDir)) {
    rmSync(installDir, { recursive: true, force: true });
  }
  if (tarball && existsSync(tarball)) {
    rmSync(tarball, { force: true });
  }
  if (npmCacheDir && existsSync(npmCacheDir)) {
    rmSync(npmCacheDir, { recursive: true, force: true });
  }
}
