import { describe, expect, it } from "vitest";
import { applyProviderHeaders, materializeProviderHeaders } from "../src/utils/headers.ts";

describe("provider headers", () => {
	it("applies null deletion case-insensitively to Headers", () => {
		const headers = new Headers({ Authorization: "Bearer secret", "X-Keep": "old" });
		applyProviderHeaders(headers, { authorization: null, "X-Keep": "new" });

		expect(headers.has("Authorization")).toBe(false);
		expect(headers.get("x-keep")).toBe("new");
	});

	it("materializes nullable layers for string-only SDKs", () => {
		expect(
			materializeProviderHeaders(
				{ "User-Agent": "provider", "X-Keep": "yes" },
				{ "user-agent": null, "X-New": "added" },
			),
		).toEqual({ "X-Keep": "yes", "X-New": "added" });
	});
});
