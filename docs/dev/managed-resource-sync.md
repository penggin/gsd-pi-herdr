# Managed resource fingerprints

The loader keeps `dist/resources` as its preferred bundle. Source edits need a
resource rebuild before they affect a linked development installation that has
a complete `dist/resources` tree.

`GSD_RESOURCE_FINGERPRINT_MODE` controls startup fingerprint selection:

| Value | Behavior |
| --- | --- |
| `auto` (default) | Read files live when this package's own root has a `.git` file/directory, or the selected bundle is its `src/resources` directory. Otherwise use the shipped fingerprint. |
| `live` | Hash selected bundle contents on every launch, including mutable installed hotfixes. |
| `bundled` | Use a valid shipped `.managed-resources-content-hash`; hash live if it is missing or invalid. |

Package-root symlinks are resolved, so `npm link` finds the development root.
An ancestor application's `.git` does not make a dependency under `node_modules`
a development bundle. Invalid mode values fail before managed-resource writes.
No preference or installed setting is changed automatically.

The live hash uses file contents and normalized `/` separators, matching the
build/watch fingerprint format. Same-version and same-size edits trigger a
refresh. The manifest records the exact fingerprint used before copying, without
rehashing afterward. If the bundle advances during copying or before the manifest
stamp, the next live-mode launch detects the change and converges. A concurrent
edit that reverts before the next launch (ABA) can leave an inconsistent copied
file undetected; this convenience sync does not provide snapshot-copy semantics.

Read-only measurement on 2026-09-07 used the real `dist/resources` bundle: 1,510
files, 13,721,320 bytes, fingerprint `b1b1a129588e2cf6`. Live hashing took 244.924 ms
on the first measured read, then 48.997 and 49.218 ms. Reading the shipped hash
took 0.640, 0.070 and 0.023 ms and returned the same fingerprint. Filesystem cache
state was not controlled; these are local fingerprint timings, not end-to-end
startup measurements. Immutable release mode avoids reading and hashing every
file's contents. Startup still performs manifest checks, pruning, and directory
traversal to detect missing managed extension files.

Regression fixtures cover stale shipped hashes, same-size edits, unchanged
launches, a bundle changing between directory copies, and a change after copying
but before stamping. All writes target disposable fixture directories.
