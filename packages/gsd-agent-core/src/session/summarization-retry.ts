import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@gsd/pi-ai";
import { sleep } from "@gsd/pi-coding-agent/utils/sleep.js";
import type { AgentSessionHost } from "./agent-session-host.js";

export type SummarizationRetrySource =
	| { source: "branchSummary" }
	| { source: "compaction"; reason: "manual" | "threshold" | "overflow" };

export type SummaryCompleteFn = (
	model: Model<any>,
	context: Context,
	options: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export function createRetryingSummaryCompleteFn(
	host: AgentSessionHost,
	source: SummarizationRetrySource,
): SummaryCompleteFn {
	return async (model, context, options) => {
		const settings = host.settingsManager.getRetrySettings();
		const maxRetries = settings.enabled ? settings.maxRetries : 0;
		let retriesStarted = false;

		try {
			for (let retry = 0; ; retry++) {
				const stream = await host.agent.streamFn(model, context, options);
				const response = await stream.result();
				if (retry >= maxRetries || !host.isRetryableError(response)) return response;

				const attempt = retry + 1;
				const delayMs = settings.baseDelayMs * 2 ** retry;
				retriesStarted = true;
				host.emit({
					type: "summarization_retry_scheduled",
					attempt,
					maxAttempts: maxRetries,
					delayMs,
					errorMessage: response.errorMessage ?? "Summarization failed",
				});
				await sleep(delayMs, options.signal);
				host.emit({ type: "summarization_retry_attempt_start", ...source });
			}
		} finally {
			if (retriesStarted) host.emit({ type: "summarization_retry_finished" });
		}
	};
}
