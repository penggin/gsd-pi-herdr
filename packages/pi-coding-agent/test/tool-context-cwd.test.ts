import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { createFindToolDefinition } from "../src/core/tools/find.ts";
import { createGrepToolDefinition } from "../src/core/tools/grep.ts";
import { createLsToolDefinition } from "../src/core/tools/ls.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";

const creationCwd = "/creation-cwd";
const sessionCwd = "/session-cwd";
const ctx = { cwd: sessionCwd } as ExtensionContext;

describe("cwd-sensitive tool definitions", () => {
	it("uses the execution context cwd for bash", async () => {
		const exec = vi.fn(async () => ({ exitCode: 0 }));
		const tool = createBashToolDefinition(creationCwd, { operations: { exec } });

		await tool.execute("bash-1", { command: "pwd" }, undefined, undefined, ctx);

		expect(exec).toHaveBeenCalledWith("pwd", sessionCwd, expect.any(Object));
	});

	it("uses the execution context cwd for read", async () => {
		const access = vi.fn(async () => {});
		const readFile = vi.fn(async () => Buffer.from("context content"));
		const tool = createReadToolDefinition(creationCwd, {
			operations: { access, readFile, detectImageMimeType: async () => undefined },
		});

		await tool.execute("read-1", { path: "file.txt" }, undefined, undefined, ctx);

		expect(access).toHaveBeenCalledWith(`${sessionCwd}/file.txt`);
		expect(readFile).toHaveBeenCalledWith(`${sessionCwd}/file.txt`);
	});

	it("uses the execution context cwd for write", async () => {
		const mkdir = vi.fn(async () => {});
		const writeFile = vi.fn(async () => {});
		const tool = createWriteToolDefinition(creationCwd, { operations: { mkdir, writeFile } });

		await tool.execute("write-1", { path: "file.txt", content: "new" }, undefined, undefined, ctx);

		expect(mkdir).toHaveBeenCalledWith(sessionCwd);
		expect(writeFile).toHaveBeenCalledWith(`${sessionCwd}/file.txt`, "new");
	});

	it("uses the execution context cwd for edit", async () => {
		const access = vi.fn(async () => {});
		const readFile = vi.fn(async () => Buffer.from("old"));
		const writeFile = vi.fn(async () => {});
		const tool = createEditToolDefinition(creationCwd, { operations: { access, readFile, writeFile } });

		await tool.execute(
			"edit-1",
			{ path: "file.txt", edits: [{ oldText: "old", newText: "new" }] },
			undefined,
			undefined,
			ctx,
		);

		expect(access).toHaveBeenCalledWith(`${sessionCwd}/file.txt`);
		expect(writeFile).toHaveBeenCalledWith(`${sessionCwd}/file.txt`, "new");
	});

	it("uses the execution context cwd for find", async () => {
		const exists = vi.fn(async () => true);
		const glob = vi.fn(async () => []);
		const tool = createFindToolDefinition(creationCwd, { operations: { exists, glob } });

		await tool.execute("find-1", { pattern: "*.ts" }, undefined, undefined, ctx);

		expect(exists).toHaveBeenCalledWith(sessionCwd);
		expect(glob).toHaveBeenCalledWith("*.ts", sessionCwd, expect.any(Object));
	});

	it("uses the execution context cwd for grep", async () => {
		const isDirectory = vi.fn(async () => {
			throw new Error("stop after path resolution");
		});
		const tool = createGrepToolDefinition(creationCwd, {
			operations: { isDirectory, readFile: async () => "" },
		});

		await expect(tool.execute("grep-1", { pattern: "needle" }, undefined, undefined, ctx)).rejects.toThrow(
			`Path not found: ${sessionCwd}`,
		);
		expect(isDirectory).toHaveBeenCalledWith(sessionCwd);
	});

	it("uses the execution context cwd for ls", async () => {
		const exists = vi.fn(async () => true);
		const stat = vi.fn(async () => ({ isDirectory: () => true }));
		const readdir = vi.fn(async () => []);
		const tool = createLsToolDefinition(creationCwd, { operations: { exists, stat, readdir } });

		await tool.execute("ls-1", {}, undefined, undefined, ctx);

		expect(exists).toHaveBeenCalledWith(sessionCwd);
		expect(stat).toHaveBeenCalledWith(sessionCwd);
		expect(readdir).toHaveBeenCalledWith(sessionCwd);
	});
});
