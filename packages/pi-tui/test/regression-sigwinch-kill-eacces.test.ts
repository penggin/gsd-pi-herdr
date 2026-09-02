import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import { refreshTerminalDimensions } from "../src/terminal.ts";

describe("refreshTerminalDimensions", () => {
	const originalKill = process.kill;
	const originalPlatform = process.platform;

	afterEach(() => {
		process.kill = originalKill;
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	it("does not throw when a restricted runtime rejects the self-signal", () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		process.kill = (() => {
			const error = new Error("kill EACCES") as NodeJS.ErrnoException;
			error.code = "EACCES";
			throw error;
		}) as typeof process.kill;

		assert.doesNotThrow(() => refreshTerminalDimensions());
	});

	it("does not signal on Windows", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		let killCalled = false;
		process.kill = (() => {
			killCalled = true;
			return true;
		}) as typeof process.kill;

		refreshTerminalDimensions();

		assert.equal(killCalled, false);
	});
});
