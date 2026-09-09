import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { TUI, isImageLine, resetCapabilitiesCache, setCapabilities, setCellDimensions, visibleWidth } from "@gsd/pi-tui";
import { initTheme } from "@gsd/pi-coding-agent/theme/theme.js";
import { VirtualTerminal } from "../../../../../pi-tui/test/virtual-terminal.ts";
import { ToolExecutionComponent } from "./tool-execution.js";
import { isRailAnimationEnabled, setRailAnimationEnabled } from "./transcript-design.js";

class RecordingTerminal extends VirtualTerminal {
  writes: string[] = [];
  override write(data: string): void { this.writes.push(data); super.write(data); }
  resetWrites(): void { this.writes = []; }
  bytes(): number { return Buffer.byteLength(this.writes.join("")); }
}

async function liveTool(t: TestContext, lineCount: number) {
  initTheme("dark", false);
  const previousAnimation = isRailAnimationEnabled();
  setRailAnimationEnabled(true);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const terminal = new RecordingTerminal(80, 24);
  const ui = new TUI(terminal);
  const contents = (count: number) => Array.from({ length: count }, (_, index) => `const row${index} = ${index};`).join("\n");
  const tool = new ToolExecutionComponent("write", { path: "fixture.ts", content: contents(lineCount) }, { showImages: false }, undefined, ui);
  tool.setExpanded(true);
  ui.addChild(tool);
  ui.start();
  t.after(() => { tool.dispose(); ui.stop(); setRailAnimationEnabled(previousAnimation); });
  await terminal.waitForRender();
  return { tool, ui, terminal, contents, advance() { now += 2_000; } };
}

test("expanded tall WRITE timer and append paint only the visible tail with status still visible", async (t) => {
  const subject = await liveTool(t, 2000);
  const redraws = subject.ui.fullRedraws;
  subject.terminal.resetWrites();
  subject.advance();
  // Exercise the actual 70ms running-card timer, not a manual render callback.
  await new Promise((resolve) => setTimeout(resolve, 95));
  await subject.terminal.waitForRender();
  assert.ok(subject.terminal.bytes() > 0, "elapsed status must actually repaint");
  assert.equal(subject.ui.fullRedraws, redraws, "elapsed status must not force an offscreen-header repaint");
  assert.ok(subject.terminal.bytes() < 16_384, "timer paint must stay proportional to the viewport");
  assert.doesNotMatch(subject.terminal.writes.join(""), /\x1b\[[23]J/);
  const timerBytes = subject.terminal.bytes();
  assert.match(subject.terminal.getViewport().join("\n"), /running/);
  assert.match(subject.terminal.getViewport().join("\n"), /ctrl\+o collapse/);
  assert.match(stripVTControlCharacters(subject.tool.render(80)[0]), /fixture\.ts/);

  subject.terminal.resetWrites();
  subject.tool.updateArgs({ path: "fixture.ts", content: subject.contents(2001) });
  subject.advance();
  subject.ui.requestRender();
  await subject.terminal.waitForRender();
  assert.equal(subject.ui.fullRedraws, redraws);
  assert.ok(subject.terminal.bytes() < 16_384);
  assert.doesNotMatch(subject.terminal.writes.join(""), /\x1b\[[23]J/);
  t.diagnostic(`expanded WRITE: timer ${timerBytes} bytes; append ${subject.terminal.bytes()} bytes; no full redraw`);
  assert.match(subject.terminal.getViewport().join("\n"), /row2000/);
  assert.match(subject.terminal.getViewport().join("\n"), /running/);

  subject.tool.updateResult({ content: [{ type: "text", text: "Fixture write failed" }], isError: true });
  subject.ui.requestRender();
  await subject.terminal.waitForRender();
  assert.match(subject.terminal.getViewport().join("\n"), /failed/);
  subject.terminal.resize(42, 16);
  await subject.terminal.waitForRender();
  assert.match(subject.terminal.getViewport().join("\n"), /failed/);
});

test("short and collapsed WRITE cards retain header status after presentation changes", async (t) => {
  const subject = await liveTool(t, 3);
  assert.match(stripVTControlCharacters(subject.tool.render(80)[0]), /fixture\.ts.*running/);
  subject.tool.updateResult({ content: [{ type: "text", text: "Fixture written" }], isError: false });
  subject.ui.requestRender();
  await subject.terminal.waitForRender();
  assert.match(stripVTControlCharacters(subject.tool.render(80)[0]), /success/);
  subject.tool.setExpanded(false);
  subject.ui.requestRender();
  await subject.terminal.waitForRender();
  assert.match(subject.terminal.getViewport().join("\n"), /success/);
  assert.match(subject.terminal.getViewport().join("\n"), /ctrl\+o expand/);
});

test("WRITE footer follows viewport height on resize without losing current status", async (t) => {
  const subject = await liveTool(t, 30);
  assert.doesNotMatch(stripVTControlCharacters(subject.tool.render(80)[0]), /running/);
  assert.match(subject.terminal.getViewport().join("\n"), /running/);
  subject.terminal.resize(80, 100);
  await subject.terminal.waitForRender();
  assert.match(stripVTControlCharacters(subject.tool.render(80)[0]), /running/);
  assert.equal(subject.terminal.getViewport().join("\n").match(/running/g)?.length, 1);
  subject.terminal.resize(80, 12);
  await subject.terminal.waitForRender();
  assert.doesNotMatch(stripVTControlCharacters(subject.tool.render(80)[0]), /running/);
  assert.match(subject.terminal.getViewport().join("\n"), /running/);
});

test("semantic changes to an offscreen WRITE header or body retain the normal full repaint", async (t) => {
  const subject = await liveTool(t, 2000);
  const initial = subject.ui.fullRedraws;
  subject.tool.updateArgs({ path: "renamed.ts", content: subject.contents(2000) });
  subject.ui.requestRender();
  await subject.terminal.waitForRender();
  assert.ok(subject.ui.fullRedraws > initial, "a changed path must not be hidden by the stable-status layout");
  assert.match(stripVTControlCharacters(subject.tool.render(80)[0]), /renamed\.ts/);
  const afterPath = subject.ui.fullRedraws;
  subject.tool.updateArgs({ path: "renamed.ts", content: subject.contents(2000).replace("const row0 = 0;", "const changed = true;") });
  subject.ui.requestRender();
  await subject.terminal.waitForRender();
  assert.ok(subject.ui.fullRedraws > afterPath, "real historical content changes must still repaint");
});

test("expanded renderers without usable terminal dimensions retain header metadata", () => {
  for (const rows of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const tool = new ToolExecutionComponent("write", { path: "fixture.ts", content: "line\n".repeat(40) }, { showImages: false }, undefined,
      { requestRender() {}, ...(rows === undefined ? {} : { terminal: { rows } }) } as any);
    try {
      tool.setExpanded(true);
      assert.match(stripVTControlCharacters(tool.render(80)[0]), /running/);
    } finally { tool.dispose(); }
  }
});

test("a tall expanded image retains its reserved rows before the visible success footer", async (t) => {
  initTheme("dark", false);
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  setCellDimensions({ widthPx: 8, heightPx: 20 });
  const terminal = new RecordingTerminal(80, 12);
  const ui = new TUI(terminal);
  const tool = new ToolExecutionComponent("read", { file_path: "fixture.png" }, { showImages: true }, undefined, ui);
  t.after(() => { tool.dispose(); ui.stop(); resetCapabilitiesCache(); setCellDimensions({ widthPx: 9, heightPx: 18 }); });
  const png = Buffer.alloc(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(2400, 20);
  tool.setExpanded(true);
  tool.updateResult({ content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }], isError: false });
  ui.addChild(tool);
  ui.start();
  await terminal.waitForRender();
  const lines = tool.render(80);
  const imageIndex = lines.findIndex(isImageLine);
  const footerIndex = lines.findIndex((line) => stripVTControlCharacters(line).includes("success"));
  assert.ok(imageIndex > 0);
  assert.ok(footerIndex > imageIndex + 10, "the status footer must follow the reserved image height");
  assert.ok(lines.slice(imageIndex + 1, footerIndex).filter((line) => stripVTControlCharacters(line).trim() === "").length >= 10);
  assert.match(terminal.getViewport().join("\n"), /success/);
  for (const width of [20, 30, 42]) {
    assert.ok(tool.render(width).filter((line) => !isImageLine(line)).every((line) => visibleWidth(line) <= width));
  }
});
