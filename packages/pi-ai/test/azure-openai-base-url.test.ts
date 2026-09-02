import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import {
	streamAzureOpenAIResponses,
	streamSimpleAzureOpenAIResponses,
} from "../src/providers/azure-openai-responses.ts";
import type { Context } from "../src/types.ts";

interface CapturedAzureClientOptions {
	apiKey: string;
	apiVersion: string;
	dangerouslyAllowBrowser: boolean;
	defaultHeaders?: Record<string, string>;
	baseURL: string;
}

interface CapturedAzureResponsesPayload {
	model?: string;
	prompt_cache_key?: string;
	max_output_tokens?: number;
	tool_choice?: unknown;
	tools?: unknown[];
}

const azureMock = vi.hoisted(() => ({
	constructorCalls: [] as CapturedAzureClientOptions[],
	lastParams: undefined as CapturedAzureResponsesPayload | undefined,
}));

vi.mock("openai", () => {
	class AzureOpenAI {
		responses = {
			create: (params: CapturedAzureResponsesPayload) => {
				azureMock.lastParams = params;
				throw new Error("mock create");
			},
		};

		constructor(config: CapturedAzureClientOptions) {
			azureMock.constructorCalls.push(config);
		}
	}

	return { AzureOpenAI };
});

const context: Context = {
	messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
};

const originalAzureOpenAIBaseUrl = process.env.AZURE_OPENAI_BASE_URL;
const originalAzureOpenAIResourceName = process.env.AZURE_OPENAI_RESOURCE_NAME;
const originalAzureOpenAIApiVersion = process.env.AZURE_OPENAI_API_VERSION;
const originalAzureOpenAIApiKey = process.env.AZURE_OPENAI_API_KEY;

beforeEach(() => {
	azureMock.constructorCalls.length = 0;
	azureMock.lastParams = undefined;
	delete process.env.AZURE_OPENAI_BASE_URL;
	delete process.env.AZURE_OPENAI_RESOURCE_NAME;
	delete process.env.AZURE_OPENAI_API_VERSION;
	delete process.env.AZURE_OPENAI_API_KEY;
});

afterEach(() => {
	if (originalAzureOpenAIBaseUrl === undefined) {
		delete process.env.AZURE_OPENAI_BASE_URL;
	} else {
		process.env.AZURE_OPENAI_BASE_URL = originalAzureOpenAIBaseUrl;
	}

	if (originalAzureOpenAIResourceName === undefined) {
		delete process.env.AZURE_OPENAI_RESOURCE_NAME;
	} else {
		process.env.AZURE_OPENAI_RESOURCE_NAME = originalAzureOpenAIResourceName;
	}

	if (originalAzureOpenAIApiVersion === undefined) {
		delete process.env.AZURE_OPENAI_API_VERSION;
	} else {
		process.env.AZURE_OPENAI_API_VERSION = originalAzureOpenAIApiVersion;
	}

	if (originalAzureOpenAIApiKey === undefined) {
		delete process.env.AZURE_OPENAI_API_KEY;
	} else {
		process.env.AZURE_OPENAI_API_KEY = originalAzureOpenAIApiKey;
	}
});

async function captureClientBaseUrl(baseUrl: string): Promise<string> {
	process.env.AZURE_OPENAI_BASE_URL = baseUrl;
	const model = getModel("azure-openai-responses", "gpt-4o-mini");
	await streamAzureOpenAIResponses(model, context, { apiKey: "test-api-key" }).result();
	expect(azureMock.constructorCalls).toHaveLength(1);
	return azureMock.constructorCalls[0].baseURL;
}

describe("azure-openai-responses base URL normalization", () => {
	it("normalizes Cognitive Services root endpoints to /openai/v1", async () => {
		const baseURL = await captureClientBaseUrl("https://marc-quicktests-resource.cognitiveservices.azure.com");
		expect(baseURL).toBe("https://marc-quicktests-resource.cognitiveservices.azure.com/openai/v1");
	});

	it("normalizes Azure OpenAI root endpoints to /openai/v1", async () => {
		const baseURL = await captureClientBaseUrl("https://my-resource.openai.azure.com");
		expect(baseURL).toBe("https://my-resource.openai.azure.com/openai/v1");
	});

	it("normalizes /openai to /openai/v1", async () => {
		const baseURL = await captureClientBaseUrl("https://my-resource.cognitiveservices.azure.com/openai");
		expect(baseURL).toBe("https://my-resource.cognitiveservices.azure.com/openai/v1");
	});

	it("preserves /openai/v1 endpoints", async () => {
		const baseURL = await captureClientBaseUrl("https://my-resource.cognitiveservices.azure.com/openai/v1");
		expect(baseURL).toBe("https://my-resource.cognitiveservices.azure.com/openai/v1");
	});

	it("preserves explicit non-Azure proxy paths", async () => {
		const baseURL = await captureClientBaseUrl("https://my-proxy.example.com/v1");
		expect(baseURL).toBe("https://my-proxy.example.com/v1");
	});

	it("strips query params when normalizing Azure host URLs", async () => {
		const baseURL = await captureClientBaseUrl("https://my-resource.openai.azure.com/openai?api-version=2024-12-01");
		expect(baseURL).toBe("https://my-resource.openai.azure.com/openai/v1");
	});

	it("preserves query params on non-Azure proxy URLs", async () => {
		const baseURL = await captureClientBaseUrl("https://my-proxy.example.com/v1?custom=true");
		expect(baseURL).toBe("https://my-proxy.example.com/v1?custom=true");
	});

	it("throws on invalid URLs", async () => {
		process.env.AZURE_OPENAI_BASE_URL = "not-a-url";
		const model = getModel("azure-openai-responses", "gpt-4o-mini");
		const result = await streamAzureOpenAIResponses(model, context, { apiKey: "test-api-key" }).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("Invalid Azure OpenAI base URL");
	});

	it("clamps prompt_cache_key to OpenAI's 64-character limit", async () => {
		const model = getModel("azure-openai-responses", "gpt-4o-mini");
		await streamAzureOpenAIResponses(model, context, {
			apiKey: "test-api-key",
			azureBaseUrl: "https://my-resource.openai.azure.com",
			sessionId: "x".repeat(67),
		}).result();

		expect(azureMock.lastParams?.prompt_cache_key).toBe("x".repeat(64));
	});

	it("preserves the provider minimum when the remaining context is exhausted", async () => {
		process.env.AZURE_OPENAI_BASE_URL = "https://my-resource.openai.azure.com";
		const baseModel = getModel("azure-openai-responses", "gpt-4o-mini");
		const model = { ...baseModel, contextWindow: 1 };
		await streamSimpleAzureOpenAIResponses(model, context, {
			apiKey: "test-api-key",
		}).result();

		expect(azureMock.lastParams?.max_output_tokens).toBe(16);
	});

	it("forwards provider-specific required tool choice", async () => {
		process.env.AZURE_OPENAI_BASE_URL = "https://my-resource.openai.azure.com";
		const model = getModel("azure-openai-responses", "gpt-4o-mini");
		await streamAzureOpenAIResponses(
			model,
			{
				messages: [{ role: "user", content: "Call read.", timestamp: Date.now() }],
				tools: [{ name: "read", description: "Read", parameters: Type.Object({ path: Type.String() }) }],
			},
			{ apiKey: "test-api-key", toolChoice: "required" },
		).result();

		expect(azureMock.lastParams).toMatchObject({ tool_choice: "required" });
		expect(azureMock.lastParams?.tools).toHaveLength(1);
	});

	it("forwards provider-neutral none tool choice from simple options", async () => {
		process.env.AZURE_OPENAI_BASE_URL = "https://my-resource.openai.azure.com";
		const model = getModel("azure-openai-responses", "gpt-4o-mini");
		await streamSimpleAzureOpenAIResponses(
			model,
			{
				messages: [{ role: "user", content: "Answer without tools.", timestamp: Date.now() }],
				tools: [{ name: "read", description: "Read", parameters: Type.Object({ path: Type.String() }) }],
			},
			{ apiKey: "test-api-key", toolChoice: "none" },
		).result();

		expect(azureMock.lastParams).toMatchObject({ tool_choice: "none" });
		expect(azureMock.lastParams?.tools).toHaveLength(1);
	});

	it("builds correct default URL from AZURE_OPENAI_RESOURCE_NAME", async () => {
		process.env.AZURE_OPENAI_RESOURCE_NAME = "my-resource";
		const model = getModel("azure-openai-responses", "gpt-4o-mini");
		await streamAzureOpenAIResponses(model, context, { apiKey: "test-api-key" }).result();
		expect(azureMock.constructorCalls).toHaveLength(1);
		expect(azureMock.constructorCalls[0].baseURL).toBe("https://my-resource.openai.azure.com/openai/v1");
	});

	it("resolves simple requests from a scoped Azure environment", async () => {
		const model = getModel("azure-openai-responses", "gpt-4o-mini");
		await streamSimpleAzureOpenAIResponses(model, context, {
			env: {
				AZURE_OPENAI_API_KEY: "scoped-key",
				AZURE_OPENAI_BASE_URL: "https://scoped-resource.openai.azure.com",
				AZURE_OPENAI_API_VERSION: "2026-08-01",
				AZURE_OPENAI_DEPLOYMENT_NAME_MAP: "gpt-4o-mini=scoped-deployment",
			},
		}).result();

		expect(azureMock.constructorCalls).toHaveLength(1);
		expect(azureMock.constructorCalls[0]).toMatchObject({
			apiKey: "scoped-key",
			apiVersion: "2026-08-01",
			baseURL: "https://scoped-resource.openai.azure.com/openai/v1",
		});
		expect(azureMock.lastParams?.model).toBe("scoped-deployment");
		expect(process.env.AZURE_OPENAI_API_KEY).toBeUndefined();
	});
});
