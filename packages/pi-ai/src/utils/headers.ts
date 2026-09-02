import type { ProviderHeaders } from "../types.js";

export function headersToRecord(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		result[key] = value;
	}
	return result;
}

/** Apply nullable provider headers using HTTP case-insensitive semantics. */
export function applyProviderHeaders(target: Headers, source?: ProviderHeaders): Headers {
	for (const [key, value] of Object.entries(source ?? {})) {
		if (value === null) target.delete(key);
		else target.set(key, value);
	}
	return target;
}

/** Merge nullable header layers for SDKs that accept only concrete strings. */
export function materializeProviderHeaders(...sources: Array<ProviderHeaders | undefined>): Record<string, string> {
	const values = new Map<string, { key: string; value: string }>();
	for (const source of sources) {
		for (const [key, value] of Object.entries(source ?? {})) {
			const normalized = key.toLowerCase();
			if (value === null) values.delete(normalized);
			else values.set(normalized, { key, value });
		}
	}
	return Object.fromEntries([...values.values()].map(({ key, value }) => [key, value]));
}
