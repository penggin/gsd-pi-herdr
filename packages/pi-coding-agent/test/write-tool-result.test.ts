import { describe, expect, it, vi } from "vitest";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";

describe("write tool result", () => {
	it("does not label UTF-16 code-unit length as bytes", async () => {
		const mkdir = vi.fn(async () => {});
		const writeFile = vi.fn(async () => {});
		const tool = createWriteToolDefinition("/workspace", { operations: { mkdir, writeFile } });

		const result = await tool.execute("write-1", { path: "unicode.txt", content: "한글" });

		expect(result.content).toEqual([{ type: "text", text: "Successfully wrote to unicode.txt" }]);
		expect(mkdir).toHaveBeenCalledWith("/workspace");
		expect(writeFile).toHaveBeenCalledWith("/workspace/unicode.txt", "한글");
	});
});
