import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const anthropicVertexMock = vi.hoisted(() => ({
	constructorCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@anthropic-ai/vertex-sdk", () => ({
	AnthropicVertex: class AnthropicVertex {
		messages = {
			create: () => {
				throw new Error("stop after client construction");
			},
		};

		constructor(config: Record<string, unknown>) {
			anthropicVertexMock.constructorCalls.push(config);
		}
	},
}));

import { getApiProvider } from "../src/api-registry.ts";
import { getModel } from "../src/models.ts";
import { streamAnthropicVertex } from "../src/providers/anthropic-vertex.ts";
import { resetApiProviders } from "../src/providers/register-builtins.ts";
import type { Context } from "../src/types.ts";

const originalProjectId = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
const originalRegion = process.env.CLOUD_ML_REGION;

beforeEach(() => {
	anthropicVertexMock.constructorCalls.length = 0;
	delete process.env.ANTHROPIC_VERTEX_PROJECT_ID;
	delete process.env.CLOUD_ML_REGION;
});

afterEach(() => {
	if (originalProjectId === undefined) delete process.env.ANTHROPIC_VERTEX_PROJECT_ID;
	else process.env.ANTHROPIC_VERTEX_PROJECT_ID = originalProjectId;
	if (originalRegion === undefined) delete process.env.CLOUD_ML_REGION;
	else process.env.CLOUD_ML_REGION = originalRegion;
});

describe("anthropic-vertex provider", () => {
	it("registers anthropic-vertex as a built-in API provider", () => {
		resetApiProviders();

		const provider = getApiProvider("anthropic-vertex");

		expect(provider).toBeDefined();
		expect(provider?.api).toBe("anthropic-vertex");
	});

	it("constructs the Vertex client from scoped project and region values", async () => {
		const model = getModel("anthropic-vertex", "claude-sonnet-4-6");
		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		};

		await streamAnthropicVertex(model, context, {
			env: {
				ANTHROPIC_VERTEX_PROJECT_ID: "scoped-project",
				CLOUD_ML_REGION: "asia-northeast1",
			},
		}).result();

		expect(anthropicVertexMock.constructorCalls).toEqual([
			{ projectId: "scoped-project", region: "asia-northeast1" },
		]);
		expect(process.env.ANTHROPIC_VERTEX_PROJECT_ID).toBeUndefined();
		expect(process.env.CLOUD_ML_REGION).toBeUndefined();
	});
});
