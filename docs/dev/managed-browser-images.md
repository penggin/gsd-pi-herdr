# Managed browser screenshot delivery

The downstream GSD managed browser adapter must return real image content when
`browser_screenshot` or a `browser_verify` check requests a screenshot. A native
success sentence without image bytes is not screenshot evidence.

## Confirmed native 0.2.2 defect

The pinned `@opengsd/gsd-browser` MCP screenshot handler discards its daemon's
image response and returns text. The JSON CLI does expose the same session's
capture as `{byteLength, data, height, mimeType, scope, width, selector?}`.
The live Linux probe confirmed the shape without an `--output` file and without
a `result` envelope. Element captures are PNG even when JPEG was requested.

Source references: [pinned MCP handler](https://github.com/open-gsd/gsd-browser/blob/v0.2.2/cli/src/mcp.rs#L2203)
and [text wrapper](https://github.com/open-gsd/gsd-browser/blob/v0.2.2/cli/src/mcp.rs#L727).
No dependency bump or upstream source modification is part of this fix.

## Adapter boundary

Only screenshot capture uses the native JSON CLI; navigation, assertions and
other browser tools retain their established MCP path. Capture replaces the
`mcp` subcommand of the already-connected launch configuration. Command prefix,
session/identity flags, working directory and captured child environment remain
the same. This is a single capture, not a failed MCP capture followed by a second
browser engine or session.

The bridge uses argv arrays with `shell:false`. Model-supplied output paths and
unrecognized screenshot options are not forwarded or read. The response is
validated for canonical base64, byte length, PNG/JPEG format, dimensions and
successful pixel decoding through the existing `sharp` dependency. Existing
screenshot dimension constraints are reused. Raw image data appears only in the
image content block, not ordinary text, error messages or tool details.

Each capture has a 60-second subprocess timeout, a combined stdout/stderr cap
of 24 MiB, a decoded-file cap of 16 MiB and a 64-Mipixel decoder input cap.
Verification permits at most five screenshot checks and at most 16 MiB of image
content across the tool result. POSIX cancellation kills only the short-lived
CLI process group; connection teardown also aborts its captures. Pixel decoding
checks cancellation before/after work, not in the middle of a native decode.

Requested verification screenshots preserve their per-check selector, fullPage,
quality and format. They are required evidence for that tool call: a failed or
aborted capture is an explicit tool error, not successful assertions with a
silently skipped image. Checks without requested screenshots do not acquire an
image dependency. Only the always-image `browser_screenshot` declares
`producesImages`: this field is a hard provider filter, so conditional-image
`browser_verify` deliberately does not declare it. Actual filtering is tested
for the GPT/Codex Responses and GLM/OpenAI completions API paths. Existing
provider capability restrictions are not relaxed by this fix.

## Compatibility and operational limits

- GSD browser engine selection, canonical tool names, provider settings and
  lifecycle/validation authority are unchanged.
- This fixes GSD Pi's managed adapter, not standalone external clients calling
  the unchanged native `gsd-browser mcp` screenshot tool directly.
- The bridge needs a native CLI-compatible `mcp` launch. Unsupported custom
  launch shapes fail explicitly; no guessed replacement command is used.
- A missing image decoder is reported as incomplete screenshot evidence.
  Header-only validation is not treated as successful image validation.
- This bridge supports macOS and Linux. Windows fails before capture because
  equivalent launcher/native-child process-tree cancellation is not implemented;
  successful Windows screenshot support is not claimed.
- No new artifact store is introduced. Image content uses the ordinary tool
  result/session path; this is not a promise of a separate permanent PNG file.
- Remote Chrome retains the approved root-owned executable, exact AppArmor
  profile and namespace/seccomp sandbox. No administrator change or browser
  configuration migration is required for this code fix.

## Verification

The public registered-tool tests use an actual SDK stdio MCP fixture reproducing
the text-only native response, plus the confirmed native JSON capture contract.
Before the implementation, actual-image and verification-option assertions
failed while the previous 128-test browser suite passed. Regression coverage
must include invalid/missing/truncated images, MIME and size inconsistencies,
option handling, cancellation, output bounds and truthful verification failure.

For live verification use a fresh named GSD managed browser session and a private
loopback fixture: navigate, click, capture viewport PNG/JPEG, element crop,
full-page and requested verification images. Confirm content blocks decode,
browser PID/page remain unchanged across captures, sandbox is still enabled,
and only the probe's named daemon is stopped afterward. Installation identity
and actual remote outcomes are recorded in the deployment progress log.
