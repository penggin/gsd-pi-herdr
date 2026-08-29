import { randomUUID } from "node:crypto";
import { HerdrClient, type HerdrAgentState } from "../../../herdr/client.js";
import type { HerdrWorkerLaunchSpecV1, HerdrWorkerStatus } from "./artifacts.js";
import { redactSensitiveText } from "./activity.js";

const WORKER_AGENT_LABEL = "gsd-worker";

type WorkerReporterClient = Pick<HerdrClient, "isAvailable" | "reportAgent" | "reportMetadata">;

export interface HerdrWorkerReporterOptions {
  env?: NodeJS.ProcessEnv;
  client?: WorkerReporterClient;
}

export class HerdrWorkerReporter {
  private readonly client: WorkerReporterClient;
  private readonly spec: HerdrWorkerLaunchSpecV1;
  private seq = Date.now() * 1000;
  private reportQueue: Promise<void> = Promise.resolve();

  constructor(spec: HerdrWorkerLaunchSpecV1, options: HerdrWorkerReporterOptions = {}) {
    this.spec = spec;
    this.client = options.client ?? new HerdrClient(`custom:gsd-worker:${randomUUID()}`, { env: options.env });
  }

  isAvailable(): boolean {
    return this.client.isAvailable();
  }

  async initialize(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.client.isAvailable()) return;
      const title = bounded(redactSensitiveText(`${this.spec.trackingName ?? this.spec.childId} / ${this.spec.agent}`), 96);
      // Metadata tokens are merged by Herdr. Explicitly clear the prior
      // execution's terminal outcome before a retained pane starts new work.
      const tokens: Record<string, string | null> = { outcome: null };
      if (this.spec.model) tokens.model = bounded(redactSensitiveText(this.spec.model), 96);
      if (this.spec.thinking) tokens.thinking = bounded(redactSensitiveText(this.spec.thinking), 32);
      await this.client.reportMetadata(this.nextSeq(), {
        agent: WORKER_AGENT_LABEL,
        title,
        display_agent: "GSD worker",
        ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
      });
    });
  }

  async reportStatus(status: HerdrWorkerStatus, message?: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.client.isAvailable()) return;
      await this.client.reportAgent(
        WORKER_AGENT_LABEL,
        mapWorkerStatusToHerdr(status),
        this.nextSeq(),
        bounded(redactSensitiveText(message ?? status), 160),
      );
    });
  }

  async reportFinal(status: Extract<HerdrWorkerStatus, "completed" | "failed" | "aborted" | "orphaned">): Promise<void> {
    return this.enqueue(async () => {
      if (!this.client.isAvailable()) return;
      await this.client.reportAgent(
        WORKER_AGENT_LABEL,
        mapWorkerStatusToHerdr(status),
        this.nextSeq(),
        status,
      );
      await this.client.reportMetadata(this.nextSeq(), {
        agent: WORKER_AGENT_LABEL,
        tokens: { outcome: status },
      });
    });
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private enqueue(run: () => Promise<void>): Promise<void> {
    const next = this.reportQueue.then(run);
    this.reportQueue = next.catch(() => {});
    return next;
  }
}

export function mapWorkerStatusToHerdr(status: HerdrWorkerStatus): HerdrAgentState {
  switch (status) {
    case "starting":
    case "working":
    case "retrying":
      return "working";
    case "blocked":
    case "failed":
      return "blocked";
    case "orphaned":
      return "unknown";
    case "queued":
    case "completed":
    case "aborted":
      return "idle";
  }
}

function bounded(value: string, max: number): string {
  const singleLine = value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, Math.max(0, max - 1))}…`;
}
