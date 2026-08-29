import * as path from "node:path";
import type { HerdrAgentSessionRef, HerdrAgentState, HerdrClient } from "./client.js";

const DEFAULT_IDLE_DEBOUNCE_MS = 250;
const DEFAULT_ERROR_GRACE_MS = 2500;
const MAX_ERROR_MESSAGE_CHARS = 160;

interface RootReporterContext {
  isIdle?: () => boolean;
  sessionManager?: {
    getSessionFile?: () => string | undefined;
    getSessionId?: () => string | undefined;
  };
}

interface RootReporterEvent {
  reason?: string;
  messages?: unknown[];
}

export interface HerdrRootReporterOptions {
  idleDebounceMs?: number;
  errorGraceMs?: number;
}

export class HerdrRootReporter {
  private readonly client: HerdrClient;
  private readonly idleDebounceMs: number;
  private readonly errorGraceMs: number;
  private rootSession = false;
  private agentActive = false;
  private failureBlocked = false;
  private failureMessage: string | undefined;
  private lastState: HerdrAgentState | undefined;
  private lastMessage: string | undefined;
  private sessionRef: HerdrAgentSessionRef = {};
  private reportSeq = Date.now() * 1000;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(client: HerdrClient, options: HerdrRootReporterOptions = {}) {
    this.client = client;
    this.idleDebounceMs = options.idleDebounceMs ?? DEFAULT_IDLE_DEBOUNCE_MS;
    this.errorGraceMs = options.errorGraceMs ?? DEFAULT_ERROR_GRACE_MS;
  }

  isRootSession(): boolean {
    return this.rootSession;
  }

  async sessionStart(event: RootReporterEvent, ctx: RootReporterContext): Promise<void> {
    this.rootSession = true;
    this.clearTimers();
    this.clearFailure();
    this.updateSessionRef(ctx);
    await this.reportSession(event.reason);
    this.agentActive = ctx.isIdle?.() === false;
    await this.publishState(true);
  }

  agentStart(ctx: RootReporterContext): void {
    if (!this.rootSession) return;
    this.clearTimers();
    this.clearFailure();
    this.updateSessionRef(ctx);
    this.agentActive = true;
    void this.reportSession();
    void this.publishState();
  }

  agentEnd(event: RootReporterEvent): void {
    if (!this.rootSession) return;
    this.agentActive = false;
    this.clearTimers();

    const errorMessage = findAssistantError(event.messages);
    if (errorMessage) {
      // GSD/provider retry loops can emit an error end immediately before a
      // replacement agent_start. Keep the pane working during a bounded grace
      // window; a new start cancels this timer. If no retry arrives, surface the
      // durable error as blocked instead of flashing idle.
      this.failureMessage = truncate(errorMessage, MAX_ERROR_MESSAGE_CHARS);
      void this.publishState(true, "working", "retry/error grace");
      this.errorTimer = setTimeout(() => {
        this.errorTimer = undefined;
        this.failureBlocked = true;
        void this.publishState();
      }, this.errorGraceMs);
      this.errorTimer.unref?.();
      return;
    }

    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      void this.publishState();
    }, this.idleDebounceMs);
    this.idleTimer.unref?.();
  }

  async shutdown(): Promise<void> {
    if (!this.rootSession) return;
    this.rootSession = false;
    this.clearTimers();
    await this.client.releaseAgent("gsd", this.nextSeq());
  }

  private desiredState(): { state: HerdrAgentState; message?: string } {
    if (this.failureBlocked) {
      return { state: "blocked", message: this.failureMessage };
    }
    if (this.agentActive) {
      return { state: "working" };
    }
    return { state: "idle" };
  }

  private async publishState(
    force = false,
    stateOverride?: HerdrAgentState,
    messageOverride?: string,
  ): Promise<void> {
    const desired = stateOverride
      ? { state: stateOverride, message: messageOverride }
      : this.desiredState();

    if (!force && desired.state === this.lastState && desired.message === this.lastMessage) return;
    this.lastState = desired.state;
    this.lastMessage = desired.message;
    await this.client.reportAgent(
      "gsd",
      desired.state,
      this.nextSeq(),
      desired.message,
      this.sessionRef,
    );
  }

  private async reportSession(sessionStartSource?: string): Promise<void> {
    if (!this.sessionRef.agentSessionId && !this.sessionRef.agentSessionPath) return;
    await this.client.reportAgentSession(
      "gsd",
      this.nextSeq(),
      this.sessionRef,
      sessionStartSource,
    );
  }

  private updateSessionRef(ctx: RootReporterContext): void {
    let agentSessionPath: string | undefined;
    let agentSessionId: string | undefined;

    try {
      const file = ctx.sessionManager?.getSessionFile?.();
      if (typeof file === "string" && file.length > 0 && path.isAbsolute(file)) {
        agentSessionPath = file;
      }
    } catch {
      agentSessionPath = undefined;
    }

    if (!agentSessionPath) {
      try {
        const id = ctx.sessionManager?.getSessionId?.();
        if (typeof id === "string" && id.length > 0) agentSessionId = id;
      } catch {
        agentSessionId = undefined;
      }
    }

    this.sessionRef = { agentSessionPath, agentSessionId };
  }

  private nextSeq(): number {
    this.reportSeq += 1;
    return this.reportSeq;
  }

  private clearFailure(): void {
    this.failureBlocked = false;
    this.failureMessage = undefined;
  }

  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.idleTimer = undefined;
    this.errorTimer = undefined;
  }
}

function findAssistantError(messages: unknown[] | undefined): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as {
      role?: string;
      stopReason?: string;
      errorMessage?: unknown;
    } | undefined;
    if (message?.role !== "assistant") continue;
    if (message.stopReason !== "error") return undefined;
    const error = typeof message.errorMessage === "string" ? message.errorMessage.trim() : "";
    return error || "Agent ended with an error";
  }
  return undefined;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
