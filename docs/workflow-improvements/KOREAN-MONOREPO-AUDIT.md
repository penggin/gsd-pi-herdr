# Korean-input and monorepo workflow audit

Baseline: `4de9a5ee1`, branch `feature/korean-monorepo-workflow`, 2026-09-07.
Primary consumer: Pengbot's mixed pnpm/Bun/Node/Rust monorepo. Its current
checkout and preferences were read only; user state, credentials and installed
runtimes are not mutation targets. Astra delegation stays archived.

The installed audit-fix workflow could not find a phase UAT directory in this
fork. Current-source reproductions and consumer documentation are used instead.
Findings are implemented separately with regression tests and explicit commits.

| ID | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| F-01 | Snapshot absorption restages unrelated source after a scoped commit, and can leave it staged after a rejecting hook. | High | Fixed: retain separate snapshots for scoped/excluded commits. |
| F-02 | All-Korean quick/debug descriptions lose their slug, preventing valid branch recovery or debug session creation. | High | Fixed: NFC normalization and deterministic bounded ASCII fallback. |
| F-03 | Skill context tokenization discards Korean text, including explicitly configured exact token rules. | Medium | Fixed: NFC Unicode tokens/phrases in structured matching, including exclusions. |
| F-04 | Recursive Cargo discovery emits bare root Cargo verification commands without a root manifest. | Medium | Fixed: root-manifest evidence alone produces bare root verification commands. |
| F-05 | Workspace members lacking local lockfiles inherit npm instead of their declared parent pnpm manager. | Medium | Fixed: nearest explicit workspace membership with local precedence and repository boundaries. |
| F-06 | Freeform Korean questions/negations fall into quick execution, and mixed `merge 하지 말고 ...` can route to ship. | High | Fixed: bounded explicit-intent shorthand and non-executing clarification. |

The later F-06 authorization finding expands this audit beyond its initial five
items. It takes priority over the remaining medium-severity fixes. Runtime
routing remains deterministic; ambiguous instructions must not become quick,
ship, cleanup or lifecycle actions merely because a keyword occurred.

## Preservation and non-goals

- Preserve role/provider/effort/context and explicit fallback/override policies.
- Do not restore Astra, create a different orchestrator, or add persistent gates,
  locks, journals, DB schemas or automatic recovery rules for these fixes.
- Preserve unrelated staged/unstaged files and existing hook/signing behavior.
- Preserve existing ASCII identifiers and legacy skill-rule semantics wherever
  possible; structured rules remain exact, not substring or translated guesses.
- No automatic migration of consumer preferences. Korean intent does not imply
  permission to mutate source, approve UAT, deploy or run a suggested assessment.
- Aggregate test scripts and the consumer's pinned pnpm wrapper remain explicit
  operator/project choices; do not infer that root-wide verification is wanted.

## Evidence and completion

Initial existing Git scope/hook/absorption coverage passed 17 tests while the
new disposable Git reproduction demonstrated F-01 (both success and hook-failure
paths). Initial package-manager/detection coverage passed 125 tests while
read-only consumer probes demonstrated F-04/F-05. Final fix-specific and cross-
workflow regression results are recorded here as each finding is resolved.

No production installation, push or consumer DB/state changes are implied by
passing repository tests.

### F-01 — Scoped commit preservation

Snapshot absorption is a history optimization, not permission to broaden a
commit's source scope. `autoCommit` now skips absorption if task-scoped staging
succeeded (initially or on hook retry), or if the caller supplied exclusions.
Snapshots remain separate commits. Unscoped staging fallback, ordinary
absorption, explicit opt-out, user hooks and signing are unchanged.

Real-Git tests first failed in five places: unrelated modified/untracked files
entered successful commits, rejecting hooks left those files staged, and the
scoped retry hook ran an extra time. After the fix the targeted matrix passes
8/8 and the full Git service integration file passes 80/80. Extension typecheck
and diff review pass. The consumer's temporary automatic-Git override is not
removed; adopting a built runtime and re-enabling it remains an operator action.

### F-06 — Freeform requests are not blanket execution approval

`/gsd do` now uses a pure production resolver tested through its real handler.
English commands match anchored words/phrases instead of arbitrary substrings.
Common Korean status/history/log/context requests and explicit capture prefixes
are normalized for matching while original task/capture text is preserved.
Negated, hypothetical and unsupported requests get an explicit-command hint,
not an unconditional quick task. This is a bounded shorthand grammar, not a
general language classifier or a replacement for existing command guards.

Examples:

| Input | Result |
| --- | --- |
| `현재 상태가 어때?` | Show status. |
| `merge 하지 말고 상태만 알려줘` | Show status; do not ship. |
| `what happens if we merge?` | Clarify; do not execute. |
| `what's next?` | Show status; do not advance a task. |
| `메모해 다음에 결제 검증 추가` | Capture the unchanged note body. |
| `로그인 오류를 수정해줘` | Explicit quick task. |
| `merge.md 파일을 수정해줘` | Quick task for the file, not ship. |
| `show me logs clear` | Clarify; do not clear logs. |

Direct `/gsd quick`, `/gsd auto`, `/gsd ship` and other explicit commands keep
their existing semantics. Unknown freeform text no longer implicitly means
quick; use `/gsd quick <task>` if the shorthand does not recognize the phrasing.
No provider call, persistent record or additional startup policy is needed to
classify input. Resolver/handler tests also reject
non-colon capture prohibitions (`메모 금지`, `capture 안돼`) while preserving
`메모: 금지` as explicit data. Final independent review aligned the read-route
`--save` check with the existing report handler, also refusing `--saved` and
embedded `--save` strings. The final resolver/dispatcher/core matrix passed
265/265 actual Node tests (19 suites), with extension typecheck. Earlier compact
reporter totals included suites; final evidence uses Node's actual test totals.

### F-02 — Korean quick/debug descriptions

Quick/debug descriptions now share a small NFC-normalized slug helper. Existing
readable ASCII/mixed-text slugs remain unchanged; Unicode-only descriptions use
`task-<12 hex characters>` instead of producing an empty name. Original issue
and task descriptions remain intact. Existing task numbers and debug collision
suffixes still distinguish separate sessions; supplied slug/path validators are
not widened. Symbol-only quick requests stop before creating a directory/branch.

The real quick handler previously created `gsd/quick/1-`, which its own recovery
parser rejected. Regression tests cover actual Korean branch creation, inferred
return/merge cleanup, NFC/NFD equivalence, debug collisions and traversal refusal.
Final related quick/debug suite: 106/106, no skips. Extension typecheck and diff
review pass. The earlier dot output included suite markers; the three-file
focused run has 42 actual tests, not 48.

### F-03 — Structured Korean skill matching

Structured `token`, `phrase` and metadata operands now normalize to NFC;
tokens retain Unicode letters, numbers and combining marks plus existing
technical delimiters. Korean include and `none` exclusions work through the
real activation builder. Matching remains exact: `결제` does not match
`결제처리`, and English substring-negative rules remain intact.

Legacy `when` and heuristic discovery remain the existing loose ASCII matcher
for compatibility. They are not silently translated or rewritten. Projects can
explicitly choose Korean/English structured alternatives; no method becomes a
new mandatory gate. Installed-skill filtering, avoid rules, manual/suggest and
assessment policies remain unchanged.

Public activation RED: 21 passed / 5 failed. GREEN: 26/26. Combined activation,
manifest, preferences and assessment registry/tool-policy tests: 188/188 actual
Node tests, no skipped tests or suites. Extension typecheck and diff review pass.

### F-04 — Verification commands belong to their execution root

Detection preserves its root marker list before recursive ecosystem enrichment.
Only root markers supply default root verification commands. A nested
`apps/penglava/Cargo.toml` remains a Rust signal without suggesting `cargo test`
at a root lacking that manifest; Go/Python follow the same rule. Existing root
Rust/Go/Python/Ruby/Makefile commands and nested framework hints remain intact.
No recursive aggregate command or new workspace execution policy was added.

Nine new tests include mixed pnpm/Bun roots and root/nested manifest cases; the
original source fails seven of them. Detection/init/preferences/package-manager
regression passes 289/289, no skips, with extension typecheck and diff review.

### F-05 — Declared workspace package-manager inheritance

Local lockfiles and explicit local `packageManager` retain precedence. A package
without them can inherit from the nearest JSON/YAML workspace declaration only
if its physical path matches the declared include/exclude patterns. Inheritance
stops at that declaration or the nearest Git directory/file, so excluded members,
nonmembers and nested repositories do not borrow a more distant manager. No Git
process, recursive source scan, package installation or script execution is used.

YAML establishes workspace membership; a root with neither a lockfile nor
Corepack field retains the existing npm default. The detector does not infer a
custom repository wrapper or replace the actual Bun/Node/Rust script contents.

Initial RED reproduced 13 failures; review exposed four further nearest-workspace
boundary failures. Final package-manager/detection/verification-gate regression
passes 300/300 actual Node tests with no skips; extension typecheck and diff
review pass. Read-only probes on the real consumer now identify apps/api,
apps/web and apps/penglava as pnpm members. Root verification no longer emits
unscoped Cargo commands. No discovered command was executed in Pengbot.

## Final audit verification

- All six recorded fixable findings have implementation and regression tests.
- Full changed-source compiled selection since `4de9a5ee1`: 492 actual Node
  tests passed, zero failures/skips (12 suites), after the last F-06 guard edit.
- Cross-workflow matrix: 531 actual tests passed, zero failures/skips (28 suites),
  covering Git/quick lifecycle, auto loop/recovery, model policy, skills and
  assessment policies, command guards, Local/Cmux/Herdr execution and browser
  session replacement. The final report-flag edge then passed the separate
  265-test command/dispatcher/core matrix. These overlapping totals are not
  added together as unique tests.
- Extension typecheck and `build:core` pass. `build:web-host` passes and stages
  standalone output; its pre-existing nonfatal `module.createRequire` warning
  through `db/engine.ts` remains.
- Korean guide YAML examples pass the existing preference validator. Real
  consumer discovery probes pass without running commands or editing its files.
- The role resolver, model preferences, execution backends, DB schema, package
  dependencies and loader are unchanged from the pre-Astra baseline. Source
  and rebuilt runtime have no Astra delegation extension directory.
- `validate-pack` passes, including isolated install/CLI/MCP, standalone web,
  native subpath and package dependency checks. Temporary pack manifest changes
  were restored. No user install, remote deployment, push or consumer
  preference/state mutation was performed.

The audit-fix method supplied per-finding classification, red/green checks and
atomic commits; missing phase UAT metadata was handled by source-based repros,
not fabricated UAT completion. The opt-in [Korean/monorepo guide](../user-docs/korean-monorepos.md)
explains the deliberate compatibility limits and how to use the existing policy.

Status: the six audited code fixes and their documentation/verification are
complete. Operational adoption (push/install or changing the consumer's optional
preferences) remains a separate explicit operator action. This is not a claim
that every possible natural-language request is recognized or that all unrelated
legacy workflow behavior was redesigned.
