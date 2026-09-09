# Penglab deployment and Mac configuration parity — 2026-09-08

**Status:** GSD/OpenCodex ready; administrator-installed Chrome-only AppArmor
profile and sandboxed browser operation verified. GSD managed screenshot image
delivery is repaired and deployed; standalone native MCP retains its pinned-version
limitation described below. Existing interactive GSD session was not restarted.

## Installed identity

Target: `ssh penglab`, Linux x86-64, user `penglab`.

| Component | Remote version / identity |
| --- | --- |
| GSD | `@penggin/gsd-pi-herdr` 1.16.2, verified R1–R6 plus managed image-delivery fix |
| Source base HEAD | `0417606d37d69ee31cf0bda496f9617a2afbe7b0`, explicitly `dirty: true` / development artifact |
| Source content digest | `dc445e4939d15c28f12809ff46803f7e265371e1732190aab414ead9b16948f6` — 5,757 source entries |
| Package SHA-256 | `230c8983c091b8300cf2416eef2a0065ee3189a41ba7fdbfd4181890156a4b48` — 63,434,050 bytes |
| Managed resource fingerprint | `439fb4b0bac83b30` |
| OpenCodex | `@bitkyc08/opencodex` 2.42.0, bundled Bun 1.4.0 |
| Native Codex CLI | 0.153.4 |
| Node / pnpm | 24.19.0 / 10.12.1 |
| General Bun / Herdr | 1.3.14 / 0.8.2, already matched Mac |

No commit, Git push, upstream mutation or Mac global reinstall was performed.
The version remains 1.16.2; it is not a claim of a full GSD upstream 1.18 merge.

Installed GSD prefix:

```text
/srv/penglab/gsd-runs/toolchains/gsd-pi-herdr-1.16.2-0417606d-dirty-230c8983
```

Source snapshot (not a Git checkout with history):

```text
/srv/penglab/gsd-runs/sources/gsd-pi-herdr-20260908-dc445e49
/srv/penglab/gsd-runs/sources/current -> the snapshot above
```

The exact package/source archives and public deployment manifest are retained in
`/srv/penglab/gsd-runs/artifacts/browser-image-fix-qDCPM4-final/`; the earlier deployment
is retained under `artifacts/deploy-20260908/`. Source archives are packaging-time
snapshots; this final operational record is copied separately into the artifact
directory rather than silently changing the source archive's hash. Platform installation adds the
verified Linux native addon and browser binary after package extraction; those
are recorded independently, not falsely included in the tarball checksum.

## Configuration parity

Transferred over SSH, with secret-bearing files kept at mode 0600:

- GSD global `PREFERENCES.md`, `defaults.json`, agent `settings.json`,
  `models.json`, `auth.json`, `onboarding.json`, and extension registry.
- Pengbot project's `.gsd/PREFERENCES.md` and `.planning/config.json`.
- OpenCodex `config.json`, generic `auth.json` and `codex-accounts.json`.
- Separately, native Codex `~/.codex/auth.json`, which OpenCodex uses for its
  default account/catalog path even when configured pool entries are non-main.
- GSD agent definitions (13), bundled/managed skills (36), and the project's
  eight method/assessment skills, retaining provenance/license files.
- Optional `gsd-assessment-pack-gstack`, using the same existing pack mechanism.

All 12 primary configuration files compare equal to their private transfer
snapshots, and native Codex auth also compares equal. The only primary-file
translation is the Mac relative assessment-pack path to:
`/srv/penglab/gsd-runs/optional-packs/gsd-assessment-pack-gstack`.
Agent and skill directory content comparisons pass. No GSD project database,
task artifact or GSD session history was copied or overwritten.

GSD retains planning/discussion Astra medium, GLM max execution/research and
Luna fallback policies, as well as required Herdr operation. OpenCodex's separate
Mac routing choices were copied exactly, including its existing Sol/Terra/Luna
subagent and Claude-routing maps; these were not silently migrated to Astra.

Mac-specific process/PID/attestation/admin state was not copied. Linux owns its
service records and instance identity. The proxy binds only `127.0.0.1:10100`.
The user systemd service is enabled/active with lingering already enabled.

Native authentication was copied using the file-cache transfer approach described
in [OpenAI's authentication guide](https://learn.chatgpt.com/ko-KR/docs/auth).
Credentials are not included in this document or source snapshots. Later OAuth
refreshes may legitimately diverge between hosts; this is a point-in-time replica,
not a credential synchronization daemon.

The separate Codex/Claude GSD skill/runtime bundle visible under Mac user skill
directories is outside the completed GSD-Pi copy; the operator was asked whether
to include that additional runtime. No separate planning runtime was installed
implicitly, and no Mac desktop/Orca-only tools were represented as Linux-native.

## Verification and repaired prerequisite

- Core plus standalone web build passed; existing nonfatal webpack createRequire
  warning remains.
- `validate-pack` passed isolated local/global installs, workspace links, native
  subpath, CLI identity, standalone dependencies, MCP handshake and optional pack
  discovery. All prepack manifest rewrites were restored afterward.
- SSH artifact checksums passed before installation. All 13 shared executable
  links were switched after candidate checks. Previously stale `gsd-cli` and
  `gsd-pi` aliases now point to the same candidate as `gsd`/`gsd-mcp-server`.
- Ordinary and login shells resolve the new versions. The login-shell
  `~/.local/bin/gsd` follows the shared link to the candidate.
- Linux addon loads with 98 exports and SHA-256
  `b1d5b33b59cc1578eed207544a4020699f0c9d123c0247481df1914002b51da7`.
- Installed engine executes the new bounded length-continuation path using a
  local fake provider. Isolated resource sync matches fingerprint
  `e3f8e52530b4b375`; installed MCP handshake advertises 57 tools.
- Actual remote GSD ModelRegistry/Pi provider requests through OpenCodex succeed:
  Astra/medium via `openai-codex-responses` and GLM/max via `openai-completions`
  both return the exact connectivity marker and `stopReason: stop`. These were
  bounded, tool-free requests, not GSD project task dispatches.
- Herdr runtime capability check passed on Linux: 0.8.2, protocol 20, schema 1,
  all required methods present.

The first OpenCodex 2.42 startup returned healthy but **not ready** because the
remote native Codex token had expired on September 6. Copying its separately
backed-up fresh Mac auth and restarting the listener fixed readiness. `/readyz`
now returns HTTP 200 / ready / 2.42.0. Active turn count was zero before service
replacement. Startup performs OpenCodex's normal Codex catalog/config sync;
it was not assumed to be a read-only operation.

## Remaining operational boundaries

1. Existing GSD PID 948361 and Herdr PID 934555 were preserved. The GSD process
   is older than the installed candidate and still has old code loaded. End it
   normally at a safe boundary before resuming that session with the new binary;
   do not open a second writer on the same active session file. Managed extension
   code refresh happens at normal GSD startup, not with `--version` alone.
2. Browser native dependency 0.2.2 was repaired after the controlled
   `--ignore-scripts` install. Its Linux binary matches published SHA-256
   `5489cb000fe140378739d6585b4e45d53bbe4cdcc5c50c398ca080ba5d0feb76`.
   User-local Chrome for Testing 152.0.7977.82 and its libraries are installed at
   `/home/penglab/.gsd-browser/chromium/152.0.7977.82/chrome-linux64/chrome`.
   The initial user-cache executable could not create a sandbox under Ubuntu's
   userns restriction. An administrator subsequently installed the root-owned
   version and exact-path profile; this prerequisite is now resolved and tested
   below. The separate native MCP screenshot image-delivery issue is not a
   sandbox failure; GSD's adapter correction and its actual passing image tests
   are recorded in the follow-up below.

## Approved browser policy — installed by administrator and verified

The operator approved proceeding with the scoped AppArmor setup. The initial
`sudo -n -l` probe only revealed a password requirement; the operator's subsequent
interactive attempt established `penglab is not in the sudoers file`. Repeating
that command as penglab could not authorize the installation. The operator then
returned a successful installation receipt from administrator execution. No Docker/socket,
other-account probing, password-in-chat or security-bypass route was attempted.

The following script is staged on Penglab:

```text
/srv/penglab/gsd-runs/private/deploy-20260908/install-chrome-apparmor.py
SHA-256: 46fcb6a5cf295395e94eddab1b9769ed1f32753a133a4c04c39b597104e57098
```

The administrator command used for this installation is retained for provenance.
Do not rerun it against the installed destination; it deliberately refuses
existing targets:

```sh
sudo python3 -I /srv/penglab/gsd-runs/private/deploy-20260908/install-chrome-apparmor.py
```

In an existing root console, omit `sudo`. There is no need to grant penglab broad
sudo membership for this one operation. Do not paste credentials into chat.
The reported standalone `install-chrome-apparmor.py: command not found` likely
means a line break split the command; the script's existence and SHA above were
rechecked successfully. The administrator-installed runtime and profile now exist,
and the global restriction remains 1.

The script follows the application-specific user-namespace pattern in
[Ubuntu's release notes](https://discourse.ubuntu.com/t/ubuntu-24-04-lts-noble-numbat-release-notes/39890).
It copied the pinned archive into root-private staging, verified that copied
snapshot, safely extracted all 308 entries and installed root-owned, non-setid files
under `/opt/gsd-browser/chromium/152.0.7977.82/`. It attaches a separate versioned
profile only to the actual `chrome-linux64/chrome` ELF, never to a user-writable
home path or wildcard. `apparmor_restrict_unprivileged_userns=1` remains required.
There is no AppArmor service restart or global sysctl change.

The profile's `flags=(unconfined)` plus `userns,` is an Ubuntu-style namespace
allowance, not a claim of a complete AppArmor filesystem policy. Chromium keeps
its own sandbox; no `--no-sandbox` or setuid helper permission is added. Ordinary
profile inheritance and environment-loaded code behavior still apply.

Seven unprivileged tests pass on both Mac and Penglab; the deployment preflight
passes on Penglab. The tests check
archive path/link/setid/size restrictions, bounded copying, the exact attachment
path and rejection of unprivileged installation. The real host parser compiles
the profile with `--skip-kernel-load --skip-cache`; the actual 308-entry archive
hash matches. Subsequent verification found the installed tree's 317 entries
(including directories/receipt) root-owned, without symlinks, setid bits or
group/world write permission. The running browser's `/proc/<pid>/exe` resolves
the pinned root-owned Chrome and `/proc/<pid>/attr/current` reports
`gsd-browser-chromium-152.0.7977.82 (unconfined)`.

The installer refuses existing targets. Before a load attempt, failed artifacts
are preserved privately where possible. A failed or timed-out load may already
have reached the kernel: in that case it reports loaded/not-listed/unknown state
and retains the matching profile/runtime for administrator inspection, rather
than guessing at an unload. No successful rollback is claimed on such a failure.

### Persistent path and headless operation

`/home/penglab/.gsd-browser/config.toml` now contains the following, owned by
penglab with mode 0600:

```toml
[browser]
path = "/opt/gsd-browser/chromium/152.0.7977.82/chrome-linux64/chrome"
headless = true
```

The native 0.2.2 default is headed operation. A path-only test failed with
`Missing X server or $DISPLAY`, so headless mode is explicit for this SSH server.
The setting is native user configuration, not a shell-only environment override;
GSD's managed MCP child also reads it despite filtering ambient browser variables.
Prior absence and the intermediate path-only file are preserved privately as
`browser-path-before.json` and `browser-path-pre-headless.toml`.

### Actual browser verification

- Tests ran as uid 1001/penglab, never root, with fresh named sessions and no
  existing browser profile or external target.
- Default CLI startup works with no `--browser-path` or headless environment
  override. about:blank DOM creation, snapshot, button click and PNG screenshot
  all pass; the captured PNG is 16,079 bytes.
- `chrome://sandbox` confirms Namespace layer-1 sandbox, PID/network namespaces
  and Seccomp-BPF enabled. No `--no-sandbox` flag was used. Global AppArmor userns
  restriction remains 1.
- The actual installed GSD `registerManagedGsdBrowserTools` adapter registered
  18 tools and used its real stdio MCP transport. Navigation, JavaScript evaluation
  and translated click succeed with the persistent user config. The managed
  browser has the same root-owned executable and AppArmor label; its internal
  sandbox page confirms sandboxing, and no sandbox-disabling arguments appear.
- Every probe closes its MCP connection and stops only its own named daemon.
  Successful-session manifests show stopped/null PIDs and no socket/PID files;
  the final process scan found no live processes from the pinned Chrome tree.
  Existing GSD/Herdr PIDs 948361/934555 were preserved, and OpenCodex remains ready.
- Local focused regression: managed browser and launch configuration tests
  27 pass, 1 installation-layout-dependent skip; downstream boundary tests
  6/6 pass; final `git diff --check` passes. These unit tests do not establish
  native MCP image delivery; the live screenshot failure below remains open.

Private evidence includes `sandbox-proof-KGxJL3/proof.json` (default CLI) and
`managed-browser-proof-8DJTxw/proof.json` (actual GSD MCP path), under the private
deployment directory. The install receipt's `browserSmokePending: true` records
the moment of installation; these subsequent proofs record the completed checks.

### Native MCP screenshot limitation — repaired in the GSD managed adapter

The pinned gsd-browser 0.2.2 `browser_screenshot` MCP handler returns success text
but discards the image response. The observed response has `evidence_refs: null`
and no image block. `mcp --json` does not change it. This matches the upstream
[screenshot branch](https://github.com/open-gsd/gsd-browser/blob/v0.2.2/cli/src/mcp.rs#L2203)
and [text response wrapper](https://github.com/open-gsd/gsd-browser/blob/v0.2.2/cli/src/mcp.rs#L727).
The handler also ignores the advertised quality/format arguments.

Native CLI `--json screenshot --output <path> --format png` captures a valid image;
that alone is distinct from delivering image evidence to a GSD model. The initial
managed screenshot probe remains a recorded failure. The later explicit repair
request is implemented below; no native dependency upgrade or AppArmor change
was used to conceal that failure.

### Managed image fix deployed and verified

The GSD managed adapter now retrieves native JSON screenshot bytes using the
already-connected command, session/identity flags, cwd and child environment.
It validates and constrains PNG/JPEG data, then emits actual image content.
Requested `browser_verify` screenshots are required evidence, not silently
optional. See [the implementation contract](../dev/managed-browser-images.md)
and ADR-H049 for limits and unsupported Windows/custom-launch cases. Direct
external callers of the unchanged native MCP handler are not repaired by this
downstream adapter.

Verification after the fix:

- Core build, final extension typecheck and resource compilation pass.
- Final changed-source suite: **922 pass, 11 skips, zero failures**. Focused browser
  suite: **157 pass, 1 Windows-only skip**; adjacent launch/image tests:
  **17 pass, 1 installation-layout skip**; downstream boundary: **6/6 pass**.
  These counts overlap. Package validation passes isolated local/global installs,
  native/workspace resolution, MCP handshake and optional pack discovery.
  Final provider/image combination: **75 pass, 1 platform skip**, including the
  actual GPT/GLM tool-filter regression described below. The final candidate is
  separately installed and tested remotely after that declaration-only correction.
- Actual remote installed adapter and separately copied managed extensions both
  deliver viewport PNG (49,133 bytes), JPEG (14,803), element PNG (3,582),
  full-page PNG (72,926) and verification JPEG (17,312) through public registered
  tools. Element geometry is 240×120. A displayed viewport image visibly contains
  the fixture heading, SAME SESSION marker and CLICKED button.
- Full-page geometry is 1568×1823 versus viewport 1568×882. The first new smoke
  asserted an unscaled height of 2000 and failed; the test was corrected to honor
  existing proportional resizing, without a production change.
- Invalid format, missing selector and pre-aborted capture return explicit errors.
  Process-level tests also prove abort/close terminate a capture launcher and its
  child. The live runs preserve browser PID/page across captures, keep the exact
  root-owned Chrome/AppArmor label and confirm namespace/seccomp sandboxing.
- Final proofs under `/srv/penglab/gsd-runs/private/browser-image-fix-qDCPM4-final/`:
  `proof-XvI4XW/proof.json` (installed), `proof-7Dn6ek/proof.json` (copied resources).
  Both end `passed:true`, `stopExit:0`, `stopped:true`. Initial geometry-only
  probe `proof-2mvSeu` and the earlier passing image proofs remain under the
  non-final `browser-image-fix-qDCPM4` directory. No probe browser process remains.
- Four GSD executable links and `sources/current` were switched only after these
  gates. Normal/login shells resolve the new prefix. Linux native addon still
  has 98 exports and its prior verified hash; browser native version/hash is
  unchanged. GSD/Herdr PIDs 948361/934555 remain alive and OpenCodex is still
  HTTP 200/ready/2.42.0. No model/provider configuration, project DB, user browser
  policy, upstream repository or Mac global installation was changed.

Final provider review corrected one intermediate declaration: `producesImages`
is a hard provider tool filter, not merely an indication that a tool can sometimes
produce images. Applying it to conditional `browser_verify` would remove
image-free verification on GPT/GLM. Only always-image `browser_screenshot` retains
the flag; the real filter regression failed before this correction and passes
for completions, Responses and Codex Responses afterward. The briefly activated
`...dirty-11dd9c40` candidate was superseded by `...dirty-230c8983`; no running
GSD session was restarted during either switch. Existing provider capability
restrictions are preserved, not expanded to claim universal image support.

The isolated copied-resource probe uses a private GSD_HOME and an explicit
private skill destination, avoiding cleanup or replacement of the user's shared
skill directory. The real user's managed extensions refresh on normal GSD startup;
the active old session still needs a safe exit/restart to load the update.

## Backups and rollback

Private originals, scripts and redacted proofs are in:

```text
/srv/penglab/gsd-runs/private/deploy-20260908/
/srv/penglab/gsd-runs/private/deploy-20260908/before/
/srv/penglab/gsd-runs/private/browser-image-fix-qDCPM4/
/srv/penglab/gsd-runs/private/browser-image-fix-qDCPM4-final/
```

`backup-manifest.json` records prior shared links and primary config targets;
the `before` tree also retains agent/skill directories and native Codex auth/config
captured before token repair. Native Codex config backup is from after the first
new-proxy startup, not a claim of a pre-start full home snapshot.

For code rollback, restore the saved launcher targets or pnpm wrapper files and
the retained older prefix. Review configuration rollback separately; do not
blindly replace refreshed OAuth credentials with expired/revoked backups. Keep
all GSD runtime/session evidence. Each image-fix directory's
`launcher-backup.json` and `activation.json` record the exact old/new links.
The pre-fix `...dirty-14725a27` prefix and source snapshot remain intact;
the intermediate `...dirty-11dd9c40` is retained for audit, not recommended as
a rollback destination because of its subsequently corrected provider flag.
No backup or prior toolchain was deleted.
