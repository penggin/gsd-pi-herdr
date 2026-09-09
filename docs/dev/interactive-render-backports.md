# Interactive visibility and repaint backports

This is the downstream adaptation of the remaining UI behavior reviewed in
GSD upstream `2330218f321657e55986beafdc367b27c71211de`. Continuous streaming
render starvation was fixed earlier in the same backport batch.

## Keyboard and presentation behavior

With default bindings, Ctrl-O expands/collapses tools; Ctrl-T toggles thinking
visibility. The upstream change labelled Ctrl-O also touched the thinking path,
so both are covered here with actual CustomEditor/keybinding dispatch and xterm
terminal output. Configured keybindings continue to take precedence.

Ordinary tall-to-tall Ctrl-O collapse already uses the downstream TUI's bounded
viewport realignment. No temporary `clearOnShrink` override is introduced, and
its global policy is not changed.

Tall expanded tool cards place changing status, elapsed time and the collapse
hint at the bottom of the card. This keeps progress visible and stops an elapsed
header above the viewport from forcing the entire transcript to be replayed.
Short expanded and collapsed cards retain header status. Resizing recalculates
placement; images keep their reserved rows. Actual semantic changes to an
offscreen path or body retain the existing full-repaint fallback. This does not
promise that all terminal repaints disappear or that scrollback semantics change.

## Thinking visibility is a staged view update

Historical replay is built in separate containers before replacing the mounted
view. Current tool IDs retain their existing components, update destinations and
timer ownership. Repeated IDs in older completed messages do not steal the live
component. Pinned content and current/orphaned streaming segments are preserved;
thinking variants clone message range/theme/metadata instead of mutating the
mounted view before success.

The stage uses own property descriptors, so the real InteractiveMode's getter-only
streaming-state accessor is supported. Failed replay disposes new staged tools,
including ones trimmed out of the staged view, and leaves the old transcript and
live tools mounted. A throwing settings setter gets a best-effort restoration
attempt; this is not an atomic durable-settings storage guarantee. No GSD workflow
or Herdr runtime state is changed by the view transaction.

## Evidence

The real keyboard/WRITE fixture originally replayed 288,541 bytes and performed a
full repaint when a 2,000-line expanded WRITE grew by one line. After the change,
the same app path emits 924 bytes with no full repaint, with either shrink-policy
setting. Isolated component measurements are 141 bytes for an actual timer paint
and 296 bytes for an append. These are deterministic local terminal-write probes,
not measured SSH latency or total CPU improvements.

Verification includes 750/750 TUI/controller tests, 66/66 component regressions,
and independent repeated-ID/rollback checks. The TUI source itself is unchanged.
Thirteen inherited test expectations were maintained to match its existing
bottom anchoring, all-dimension resize realignment and tall-shrink policy. They
assert full viewport/cursor state and retain no-scrollback-clear and semantic
reflow guards. Existing TypeScript parameter-property tests require the source
runner's `--experimental-transform-types` option.

Exact commands and final combined results are in
[the implementation record](gsd-upstream-deferred-implementation.md).
