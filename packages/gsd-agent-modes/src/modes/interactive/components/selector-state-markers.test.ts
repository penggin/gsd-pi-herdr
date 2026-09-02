import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { beforeEach, describe, it } from "node:test";
import type { Model } from "@gsd/pi-ai";
import { EditorKeybindingsManager, setEditorKeybindings } from "@gsd/pi-tui";
import { initTheme } from "@gsd/pi-coding-agent/theme/theme.js";
import { ModelSelectorComponent } from "./model-selector.js";
import { ScopedModelsSelectorComponent } from "./scoped-models-selector.js";
import { SettingsSelectorComponent, type SettingsConfig } from "./settings-selector.js";
import { ThemeSelectorComponent } from "./theme-selector.js";
import { ThinkingSelectorComponent } from "./thinking-selector.js";

function plain(component: { render(width: number): string[] }): string {
	return component.render(120).map((line) => stripVTControlCharacters(line)).join("\n");
}

function model(id: string): Model<any> {
	return {
		id,
		name: id,
		provider: "test-provider",
		api: "openai-responses",
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 10_000,
	} as Model<any>;
}

describe("selector state markers", () => {
	beforeEach(() => {
		initTheme("dark", false);
		setEditorKeybindings(new EditorKeybindingsManager());
	});

	it("keeps the current thinking level marked at the start of its row", () => {
		const selector = new ThinkingSelectorComponent("medium", ["medium", "high"], () => {}, () => {});

		assert.match(plain(selector.getSelectList()), /^→ ✓ medium/m);
		selector.getSelectList().handleInput("\x1b[B");
		assert.match(plain(selector.getSelectList()), /^  ✓ medium/m);
	});

	it("keeps the saved theme marked while another theme is previewed", () => {
		const selector = new ThemeSelectorComponent("dark", () => {}, () => {}, () => {});

		assert.match(plain(selector.getSelectList()), /^→ ✓ dark/m);
		selector.getSelectList().handleInput("\x1b[B");
		assert.match(plain(selector.getSelectList()), /^  ✓ dark/m);
	});

	it("marks current thinking and theme values inside settings submenus", () => {
		const config: SettingsConfig = {
			autoCompact: true,
			showImages: true,
			autoResizeImages: true,
			blockImages: false,
			enableSkillCommands: true,
			steeringMode: "all",
			followUpMode: "all",
			transport: "auto",
			thinkingLevel: "medium",
			availableThinkingLevels: ["medium", "high"],
			currentTheme: "dark",
			availableThemes: ["dark", "light"],
			hideThinkingBlock: false,
			toolsExpanded: false,
			toolRailAnimation: true,
			collapseChangelog: false,
			doubleEscapeAction: "tree",
			treeFilterMode: "default",
			showHardwareCursor: false,
			editorPaddingX: 0,
			autocompleteMaxVisible: 10,
			respectGitignoreInPicker: true,
			quietStartup: false,
			clearOnShrink: false,
			timestampFormat: "date-time-iso",
			adaptiveMode: "auto",
		};
		const callbacks = { onCancel: () => {} } as never;

		const thinking = new SettingsSelectorComponent(config, callbacks).getSettingsList();
		for (const character of "thinking") thinking.handleInput(character);
		thinking.handleInput("\r");
		assert.match(plain(thinking), /→ ✓ medium/);

		const theme = new SettingsSelectorComponent(config, callbacks).getSettingsList();
		for (const character of "theme") theme.handleInput(character);
		theme.handleInput("\r");
		assert.match(plain(theme), /→ ✓ dark/);
	});

	it("shows all-enabled markers and disables only the selected scoped model", () => {
		const models = [model("model-a"), model("model-b")];
		const toggles: Array<[string, boolean]> = [];
		let clearCalls = 0;
		const selector = new ScopedModelsSelectorComponent(
			{ allModels: models, enabledModelIds: new Set(), hasEnabledModelsFilter: false },
			{
				onModelToggle: (id, enabled) => toggles.push([id, enabled]),
				onPersist: () => {},
				onEnableAll: () => {},
				onClearAll: () => {
					clearCalls += 1;
				},
				onToggleProvider: () => {},
				onCancel: () => {},
			},
		);

		assert.match(plain(selector), /→ ✓ model-a/);
		assert.match(plain(selector), /  ✓ model-b/);
		selector.handleInput("\r");

		assert.deepEqual(toggles, [["test-provider/model-a", false]]);
		assert.equal(clearCalls, 0);
	});

	it("places the current-model marker before the label", async () => {
		const current = model("current-model");
		const other = model("other-model");
		const modelRegistry = {
			refresh: () => {},
			getError: () => undefined,
			getAvailable: () => [current, other],
			isProviderRequestReady: () => true,
			getProviderAuthMode: () => "apiKey",
		};
		const selector = new ModelSelectorComponent(
			{ requestRender: () => {} } as never,
			current,
			{} as never,
			modelRegistry as never,
			[],
			() => {},
			() => {},
		);

		await new Promise((resolve) => setImmediate(resolve));

		assert.match(plain(selector), /→ ✓ current-model/);
		selector.handleInput("\x1b[B");
		assert.match(plain(selector), /^    ✓ current-model/m);
		assert.match(plain(selector), /→   other-model/);
	});
});
