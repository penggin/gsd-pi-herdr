// gsd-pi + packages/pi-coding-agent/src/modes/interactive/interactive-mode-lifecycle.test.ts - InteractiveMode lifecycle regression coverage.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InteractiveMode } from "./interactive-mode.js";
import { initTheme } from "@gsd/pi-coding-agent/theme/theme.js";

initTheme("dark", false);

type RuntimeInteractiveMode = {
	[key: string]: unknown;
	stop(): void;
	startNewSession(options?: unknown): Promise<boolean>;
	forkSession(entryId: string): Promise<{ selectedText: string; cancelled: boolean }>;
	resumeSession(path: string): Promise<boolean>;
	_themeChangeUnsub?: () => void;
	getMarkdownThemeWithSettings(): unknown;
};

describe("InteractiveMode lifecycle", () => {
	it("calls and clears the theme-change unsubscriber on stop", () => {
		const mode = Object.create(InteractiveMode.prototype) as RuntimeInteractiveMode;
		let unsubscribeCount = 0;

		mode.loadingAnimation = undefined;
		mode.extensionTerminalInputUnsubscribers = new Set();
		mode.clearExtensionTerminalInputListeners = () => {};
		mode._branchChangeUnsub = undefined;
		mode._themeChangeUnsub = () => {
			unsubscribeCount++;
		};
		mode.onInputCallback = undefined;
		mode.clearExtensionWidgets = () => {};
		mode.customFooter = undefined;
		mode.customHeader = undefined;
		mode.footer = { dispose() {} };
		mode.footerDataProvider = { dispose() {} };
		mode.unsubscribe = undefined;
		mode.isInitialized = false;

		mode.stop();

		assert.equal(unsubscribeCount, 1);
		assert.equal(mode._themeChangeUnsub, undefined);
	});

	it("caches markdown theme settings until the code block indent changes", () => {
		const mode = Object.create(InteractiveMode.prototype) as RuntimeInteractiveMode;
		let codeBlockIndent = "  ";
		mode.session = {
			settingsManager: {
				getCodeBlockIndent: () => codeBlockIndent,
			},
		};

		const first = mode.getMarkdownThemeWithSettings();
		assert.equal(mode.getMarkdownThemeWithSettings(), first);

		codeBlockIndent = "    ";
		const updated = mode.getMarkdownThemeWithSettings() as { codeBlockIndent: string };

		assert.notEqual(updated, first);
		assert.equal(updated.codeBlockIndent, "    ");
		assert.equal(mode.getMarkdownThemeWithSettings(), updated);
	});

	it("routes replacement commands through the runtime owner when configured", async () => {
		const mode = Object.create(InteractiveMode.prototype) as RuntimeInteractiveMode;
		const calls: unknown[] = [];
		mode.session = {
			newSession: () => assert.fail("legacy newSession should not run"),
			fork: () => assert.fail("legacy fork should not run"),
			switchSession: () => assert.fail("legacy switchSession should not run"),
		};
		mode.sessionRuntime = {
			newSession: async (options: unknown) => {
				calls.push(["new", options]);
				return { cancelled: false };
			},
			fork: async (entryId: string) => {
				calls.push(["fork", entryId]);
				return { cancelled: false, selectedText: "selected" };
			},
			switchSession: async (path: string) => {
				calls.push(["resume", path]);
				return { cancelled: false };
			},
		};

		assert.equal(await mode.startNewSession({ workspaceRoot: "/next" }), true);
		assert.deepEqual(await mode.forkSession("entry-1"), { selectedText: "selected", cancelled: false });
		assert.equal(await mode.resumeSession("/session.jsonl"), true);
		assert.deepEqual(calls, [
			["new", { workspaceRoot: "/next" }],
			["fork", "entry-1"],
			["resume", "/session.jsonl"],
		]);
	});

	it("rebinds footer, extensions, and event subscription to a replacement session", async () => {
		const mode = Object.create(InteractiveMode.prototype) as RuntimeInteractiveMode;
		const events: string[] = [];
		const nextSession = {
			autoCompactionEnabled: false,
			resourceLoader: { getThemes: () => ({ themes: [] }) },
			sessionView: { getSessionName: () => undefined, getCwd: () => "/next" },
		};
		mode.isInitialized = true;
		mode.footer = {
			setSession: (session: unknown) => {
				assert.equal(session, nextSession);
				events.push("footer-session");
			},
			setAutoCompactEnabled: (enabled: boolean) => {
				assert.equal(enabled, false);
				events.push("footer-compaction");
			},
			invalidate: () => events.push("footer-invalidate"),
		};
		mode.rebindFooterDataProvider = () => events.push("footer-data");
		mode.setupAutocomplete = () => events.push("autocomplete");
		mode.initExtensions = async () => {
			events.push("extensions");
		};
		mode.subscribeToAgent = () => events.push("subscribe");
		mode.sessionRuntime = {
			diagnostics: [
				{ type: "warning", message: "replacement warning" },
				{ type: "error", message: "replacement error" },
				{ type: "info", message: "replacement info" },
			],
			modelFallbackMessage: "replacement fallback",
		};
		mode.showWarning = (message: string) => events.push(`warning:${message}`);
		mode.showError = (message: string) => events.push(`error:${message}`);
		mode.showTip = (message: string) => events.push(`info:${message}`);
		mode.ui = {
			terminal: { setTitle() {} },
			requestRender: () => events.push("render"),
		};
		mode.session = { sessionView: { getSessionName: () => undefined } };

		await (mode.rebindSession as (session: unknown) => Promise<void>)(nextSession);

		assert.equal(mode.session, nextSession);
		assert.deepEqual(events, [
			"footer-session",
			"footer-data",
			"footer-compaction",
			"autocomplete",
			"extensions",
			"subscribe",
			"warning:replacement warning",
			"error:replacement error",
			"info:replacement info",
			"warning:replacement fallback",
			"footer-invalidate",
			"render",
		]);
	});
});
