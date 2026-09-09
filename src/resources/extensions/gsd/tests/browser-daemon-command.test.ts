import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readBoundedDaemonStderr, runBrowserDaemonCommand } from "../browser-daemon-command.ts";

test("daemon stderr reads the captured descriptor after its original pathname is replaced", (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), "gsd-daemon-stderr-fd-"));
  const file = join(dir, "stderr");
  fs.writeFileSync(file, "original descriptor evidence");
  const fd = fs.openSync(file, "r");
  t.after(() => { fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); });
  fs.renameSync(file, join(dir, "original"));
  fs.writeFileSync(file, "unrelated replacement".repeat(100_000));
  assert.equal(readBoundedDaemonStderr(fd), "original descriptor evidence");
});

test("daemon stderr honors short-read byte counts and the 4 KiB read bound", (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), "gsd-daemon-stderr-short-read-"));
  const file = join(dir, "stderr");
  fs.writeFileSync(file, "H".repeat(5_000) + "T".repeat(5_000));
  const fd = fs.openSync(file, "r");
  t.after(() => { fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); });
  const originalRead = fs.readSync;
  const requested: number[] = [];
  const mock = t.mock.method(fs, "readSync", ((descriptor: number, buffer: Buffer, offset: number, length: number, position: number) => {
    assert.equal(descriptor, fd);
    requested.push(length);
    return originalRead(descriptor, buffer, offset, Math.min(length, 3), position);
  }) as typeof fs.readSync);
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  assert.equal(readBoundedDaemonStderr(fd), "HHH\n…[truncated]\nTTT");
  assert.ok(requested.reduce((sum, length) => sum + length, 0) <= 4 * 1024);
});

test("daemon stderr does not read beyond the observed size when a small capture grows", (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), "gsd-daemon-stderr-growth-"));
  const file = join(dir, "stderr");
  fs.writeFileSync(file, "HEAD" + "x".repeat(5 * 1024 * 1024));
  const fd = fs.openSync(file, "r");
  t.after(() => { fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); });
  const stat = fs.fstatSync(fd);
  // This reader calls the numeric Stats overload; the mock never receives bigint options.
  const mock = t.mock.method(fs, "fstatSync", (() => ({ ...stat, size: 4 })) as unknown as typeof fs.fstatSync);
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  assert.equal(readBoundedDaemonStderr(fd), "HEAD");
});

test("daemon capture open failure removes the partially created directory and still returns a normal result", (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), "gsd-daemon-open-failure-"));
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  process.env.TMPDIR = process.env.TEMP = process.env.TMP = dir;
  const mock = t.mock.method(fs, "openSync", () => { throw Object.assign(new Error("open failed"), { code: "EMFILE" }); });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  const result = runBrowserDaemonCommand({ command: process.execPath, args: ["-e", "process.exitCode = 1"], cwd: dir }, {}, 5_000);
  assert.equal(result.ok, false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("daemon capture is private while the command is running", (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), "gsd-daemon-private-"));
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  process.env.TMPDIR = process.env.TEMP = process.env.TMP = dir;
  const script = [
    'const fs = require("node:fs"), path = require("node:path");',
    'const capture = fs.readdirSync(process.env.TMPDIR).find(name => name.startsWith("gsd-browser-daemon-"));',
    'if (!capture) process.exit(2);',
    'const folder = path.join(process.env.TMPDIR, capture);',
    'if (process.platform !== "win32" && ((fs.statSync(folder).mode & 0o777) !== 0o700 || (fs.statSync(path.join(folder, "stderr")).mode & 0o777) !== 0o600)) process.exit(3);',
  ].join("\n");
  assert.deepEqual(runBrowserDaemonCommand({ command: process.execPath, args: ["-e", script], cwd: dir }, {}, 5_000), { ok: true });
  assert.deepEqual(fs.readdirSync(dir), []);
});
