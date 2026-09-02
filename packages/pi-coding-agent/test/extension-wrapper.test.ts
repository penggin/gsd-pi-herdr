import type { AgentToolResult } from "@gsd/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { wrapRegisteredTool } from "../src/core/extensions/wrapper.ts";
import type { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { RegisteredTool } from "../src/core/extensions/types.ts";

function createRunner(getActiveTools: () => string[]): ExtensionRunner {
	return {
		getActiveTools,
		createContext: () => ({}),
	} as unknown as ExtensionRunner;
}

function createRegisteredTool(
	execute: () => Promise<AgentToolResult<Record<string, never>>>,
): RegisteredTool {
	return {
		definition: {
			name: "load-tools",
			label: "Load tools",
			description: "Makes additional tools available",
			parameters: Type.Object({}),
			execute,
		},
		sourceInfo: { path: "/test/extension.ts" },
	} as RegisteredTool;
}

describe("extension tool wrapper", () => {
	it("records tools added during execution without dropping existing provenance", async () => {
		let activeTools = ["load-tools"];
		const registeredTool = createRegisteredTool(async () => {
			activeTools = ["load-tools", "read", "write"];
			return {
				content: [{ type: "text", text: "loaded" }],
				details: {},
				addedToolNames: ["catalog"],
			};
		});
		const wrapped = wrapRegisteredTool(registeredTool, createRunner(() => [...activeTools]));

		const result = await wrapped.execute("call-1", {}, undefined, undefined);

		expect(result.addedToolNames).toEqual(["catalog", "read", "write"]);
	});

	it("does not describe a mixed removal and addition as a pure addition", async () => {
		let activeTools = ["load-tools", "old-tool"];
		const registeredTool = createRegisteredTool(async () => {
			activeTools = ["load-tools", "new-tool"];
			return { content: [{ type: "text", text: "changed" }], details: {} };
		});
		const wrapped = wrapRegisteredTool(registeredTool, createRunner(() => [...activeTools]));

		const result = await wrapped.execute("call-1", {}, undefined, undefined);

		expect(result.addedToolNames).toBeUndefined();
	});

	it("leaves ordinary tool results unchanged", async () => {
		const activeTools = ["load-tools"];
		const registeredTool = createRegisteredTool(async () => ({
			content: [{ type: "text", text: "unchanged" }],
			details: {},
		}));
		const wrapped = wrapRegisteredTool(registeredTool, createRunner(() => [...activeTools]));

		const result = await wrapped.execute("call-1", {}, undefined, undefined);

		expect(result).toEqual({ content: [{ type: "text", text: "unchanged" }], details: {} });
	});
});
