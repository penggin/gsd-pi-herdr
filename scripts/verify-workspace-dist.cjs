// gsd-pi + scripts/verify-workspace-dist.cjs
// Fails the release when any publishable workspace package lacks build output.
// npm publish --ignore-scripts skips per-package builds, so an unwired package
// otherwise publishes as bin+README only.
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs')
const { join, resolve, sep } = require('node:path')

const root = join(__dirname, '..')
const out = execFileSync('node', [join(__dirname, 'lib', 'npm-release-packages.cjs'), '--workspace-dirs'], { encoding: 'utf8' })
const failures = []

function hasEntries(path) {
  if (!existsSync(path)) return false
  const stat = statSync(path)
  return stat.isFile() ? stat.size > 0 : stat.isDirectory() && readdirSync(path).length > 0
}

for (const line of out.split('\n').map((l) => l.trim()).filter(Boolean)) {
  const [name, dir] = [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)]
  const packageRoot = join(root, dir)
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const pi = manifest.pi && typeof manifest.pi === 'object' ? manifest.pi : {}
  const declaredResources = ['skills', 'prompts', 'themes']
    .flatMap((kind) => Array.isArray(pi[kind]) ? pi[kind] : [])
    .filter((entry) => typeof entry === 'string')
  const hasRuntimeEntry = Boolean(manifest.main || manifest.module || manifest.bin || manifest.exports)
    || (Array.isArray(pi.extensions) && pi.extensions.length > 0)

  // A pure Pi resource package intentionally has no compiled dist/. Validate
  // every declared resource instead of requiring a fake build artifact.
  if (!hasRuntimeEntry && declaredResources.length > 0) {
    const resolvedPackageRoot = resolve(packageRoot)
    const missing = declaredResources.filter((entry) => {
      const resourcePath = resolve(packageRoot, entry)
      return !resourcePath.startsWith(`${resolvedPackageRoot}${sep}`) || !hasEntries(resourcePath)
    })
    if (missing.length > 0) failures.push(`${name} (${dir} missing resources: ${missing.join(', ')})`)
    continue
  }
  const dist = join(root, dir, 'dist')
  if (!existsSync(dist) || readdirSync(dist).length === 0) {
    failures.push(`${name} (${dir}/dist missing or empty)`)
  }
}
if (failures.length > 0) {
  process.stderr.write(`ERROR: workspace package(s) not built — refusing to publish:\n${failures.map((f) => `  - ${f}`).join('\n')}\nRun the matching build:* script (see root package.json) before publishing.\n`)
  process.exit(1)
}
process.stderr.write('All publishable workspace packages have valid runtime or resource artifacts.\n')
