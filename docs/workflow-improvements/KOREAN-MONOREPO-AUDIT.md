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
| F-02 | All-Korean quick/debug descriptions lose their slug, preventing valid branch recovery or debug session creation. | High | Reproduced; preserve bounded safe identifier contracts. |
| F-03 | Skill context tokenization discards Korean text, including explicitly configured exact token rules. | Medium | Reproduced; Unicode-aware normalization with exact structured matching. |
| F-04 | Recursive Cargo discovery emits bare root Cargo verification commands without a root manifest. | Medium | Reproduced on consumer; separate language detection from executable-root evidence. |
| F-05 | Workspace members lacking local lockfiles inherit npm instead of their declared parent pnpm manager. | Medium | Reproduced on consumer; inherit only from verified workspace membership. |
| F-06 | Freeform Korean questions/negations fall into quick execution, and mixed `merge 하지 말고 ...` can route to ship. | High | Reproduced; distinguish information/negation from explicit command intent and test the real resolver. |

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
