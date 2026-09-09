// Agent-authored fixture for the observed native 0.2.2 MCP/CLI asymmetry.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomFillSync } from "node:crypto";

const args = process.argv.slice(2);
if (args.includes("mcp")) {
  const server = new McpServer({ name: "screenshot-fixture", version: "0.2.2" });
  for (const name of ["browser_navigate", "browser_assert", "browser_screenshot"]) {
    server.registerTool(name, {}, async () => ({
      content: [{ type: "text", text: name === "browser_screenshot" ? "Screenshot captured" : `${name} passed` }],
      structuredContent: { evidence_refs: null },
    }));
  }
  await server.connect(new StdioServerTransport());
} else if (args.includes("screenshot")) {
  const expectedArgs = JSON.parse(process.env.IMAGE_TEST_EXPECTED_ARGS);
  if (JSON.stringify(args) !== JSON.stringify(expectedArgs)
    || process.cwd() !== process.env.IMAGE_TEST_CWD
    || process.env.IMAGE_TEST_IDENTITY !== "same-environment") {
    process.stderr.write("Screenshot invocation did not preserve its connection configuration");
    process.exit(2);
  }
  const mode = process.env.IMAGE_TEST_MODE;
  if (mode === "hang") {
    // Test cancellation must terminate a subprocess that ignores SIGTERM.
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
    if (process.env.IMAGE_TEST_READY_FILE) {
      const nativeChild = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], { stdio: "ignore" });
      writeFileSync(process.env.IMAGE_TEST_READY_FILE, JSON.stringify({ pid: process.pid, nativePid: nativeChild.pid }));
    }
  } else if (mode === "large") {
    const { default: sharp } = await import("sharp");
    const width = 1500;
    const height = 1500;
    const data = await sharp(randomFillSync(Buffer.alloc(width * height * 3)), { raw: { width, height, channels: 3 } }).png().toBuffer();
    process.stdout.write(JSON.stringify({ data: data.toString("base64"), byteLength: data.length, width, height, mimeType: "image/png", scope: "viewport" }));
  } else if (mode === "overflow") {
    process.stdout.write("x".repeat(25 * 1024 * 1024));
  } else if (mode === "exit") {
    process.stderr.write(process.env.IMAGE_TEST_PAYLOAD);
    process.exitCode = 3;
  } else {
    process.stdout.write(process.env.IMAGE_TEST_PAYLOAD);
  }
} else {
  process.exitCode = 4;
}
