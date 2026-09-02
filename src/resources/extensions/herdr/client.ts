import { randomUUID } from "node:crypto";
import net from "node:net";

export interface HerdrEnvironment {
  available: boolean;
  socketPath?: string;
  paneId?: string;
  workspaceId?: string;
  tabId?: string;
}

export interface HerdrRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface HerdrResponse {
  id: string;
  result?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

export interface HerdrAgentSessionRef {
  agentSessionId?: string;
  agentSessionPath?: string;
}

export type HerdrAgentState = "idle" | "working" | "blocked" | "unknown";
export type HerdrNotificationSound = "none" | "done" | "request";
export type HerdrNotificationPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface HerdrNotification {
  title: string;
  body?: string;
  sound?: HerdrNotificationSound;
  position?: HerdrNotificationPosition;
}

export interface HerdrClientOptions {
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  retryTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 500;
const DEFAULT_RETRY_TIMEOUT_MS = 1500;

let requestCounter = 0;

function nextRequestId(source: string): string {
  requestCounter += 1;
  return `${source}:${process.pid}:${Date.now()}:${requestCounter}`;
}

function socketEndpoint(socketPath: string): string {
  if (process.platform !== "win32") return socketPath;
  if (socketPath.startsWith("\\\\.\\pipe\\")) return socketPath;
  return `\\\\.\\pipe\\${socketPath}`;
}

export function detectHerdrEnvironment(env: NodeJS.ProcessEnv = process.env): HerdrEnvironment {
  const socketPath = env.HERDR_SOCKET_PATH?.trim() || undefined;
  const paneId = env.HERDR_PANE_ID?.trim() || undefined;
  const workspaceId = env.HERDR_WORKSPACE_ID?.trim() || undefined;
  const tabId = env.HERDR_TAB_ID?.trim() || undefined;
  const available = env.HERDR_ENV === "1" && Boolean(socketPath && paneId);

  return {
    available,
    socketPath,
    paneId,
    workspaceId,
    tabId,
  };
}

export function isHerdrSubagentChild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GSD_SUBAGENT_CHILD === "1";
}

export function shouldActivateHerdrRoot(
  hasUI: boolean,
  enabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return hasUI && enabled && detectHerdrEnvironment(env).available && !isHerdrSubagentChild(env);
}

/**
 * Herdr v0.8.2 retains a source's last accepted sequence watermark even after
 * pane.release_agent. Give each loaded extension runtime a distinct source so
 * a later runtime can safely restart its local sequence without stale reports.
 */
export function createHerdrRootSource(): string {
  return `custom:gsd:${randomUUID()}`;
}

export class HerdrClient {
  private readonly env: HerdrEnvironment;
  private readonly requestTimeoutMs: number;
  private readonly retryTimeoutMs: number;
  private readonly source: string;

  constructor(source = "gsd:herdr", options: HerdrClientOptions = {}) {
    this.env = detectHerdrEnvironment(options.env);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.retryTimeoutMs = options.retryTimeoutMs ?? DEFAULT_RETRY_TIMEOUT_MS;
    this.source = source;
  }

  getEnvironment(): HerdrEnvironment {
    return this.env;
  }

  isAvailable(): boolean {
    return this.env.available;
  }

  async probePane(): Promise<boolean> {
    const paneId = this.env.paneId;
    if (!paneId) return false;
    const response = await this.request("pane.get", { pane_id: paneId });
    return response !== null && !response.error;
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<HerdrResponse | null> {
    if (!this.env.available || !this.env.socketPath) return null;

    const request: HerdrRequest = {
      id: nextRequestId(this.source),
      method,
      params,
    };

    return (await this.requestOnce(request, this.requestTimeoutMs))
      ?? this.requestOnce(request, this.retryTimeoutMs);
  }

  async reportAgent(
    agent: string,
    state: HerdrAgentState,
    seq: number,
    message?: string,
    sessionRef?: HerdrAgentSessionRef,
  ): Promise<boolean> {
    const paneId = this.env.paneId;
    if (!paneId) return false;

    const response = await this.request("pane.report_agent", {
      pane_id: paneId,
      source: this.source,
      agent,
      state,
      seq,
      ...(message ? { message } : {}),
      ...sessionRefParams(sessionRef),
    });
    return response !== null && !response.error;
  }

  async reportAgentSession(
    agent: string,
    seq: number,
    sessionRef: HerdrAgentSessionRef,
    sessionStartSource?: string,
  ): Promise<boolean> {
    const paneId = this.env.paneId;
    const ref = sessionRefParams(sessionRef);
    if (!paneId || Object.keys(ref).length === 0) return false;

    const response = await this.request("pane.report_agent_session", {
      pane_id: paneId,
      source: this.source,
      agent,
      seq,
      ...(sessionStartSource ? { session_start_source: sessionStartSource } : {}),
      ...ref,
    });
    return response !== null && !response.error;
  }

  async reportMetadata(
    seq: number,
    metadata: Record<string, unknown>,
  ): Promise<boolean> {
    const paneId = this.env.paneId;
    if (!paneId) return false;

    const response = await this.request("pane.report_metadata", {
      pane_id: paneId,
      source: this.source,
      seq,
      ...metadata,
    });
    return response !== null && !response.error;
  }

  async showNotification(notification: HerdrNotification): Promise<boolean> {
    const title = notification.title.trim();
    if (!title || !this.env.available || !this.env.socketPath) return false;
    // Notifications are best-effort side effects. Unlike idempotent lifecycle
    // reports, do not retry after an ambiguous timeout: the first request may
    // already have displayed a toast even if its response was lost.
    const response = await this.requestOnce({
      id: nextRequestId(this.source),
      method: "notification.show",
      params: {
        title,
        ...(notification.body ? { body: notification.body } : {}),
        ...(notification.sound ? { sound: notification.sound } : {}),
        ...(notification.position ? { position: notification.position } : {}),
      },
    }, this.requestTimeoutMs);
    if (!response || response.error || !response.result || typeof response.result !== "object") return false;
    const result = response.result as Record<string, unknown>;
    return result.type === "notification_show" && result.shown === true;
  }

  async releaseAgent(agent: string, seq: number): Promise<boolean> {
    const paneId = this.env.paneId;
    if (!paneId) return false;

    const response = await this.request("pane.release_agent", {
      pane_id: paneId,
      source: this.source,
      agent,
      seq,
    });
    return response !== null && !response.error;
  }

  private requestOnce(request: HerdrRequest, timeoutMs: number): Promise<HerdrResponse | null> {
    const socketPath = this.env.socketPath;
    if (!socketPath) return Promise.resolve(null);

    return new Promise((resolve) => {
      let settled = false;
      let buffer = "";
      const socket = net.createConnection(socketEndpoint(socketPath));

      const finish = (response: HerdrResponse | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(response);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);
      timer.unref?.();

      socket.on("error", () => finish(null));
      socket.on("connect", () => {
        socket.write(`${JSON.stringify(request)}\n`);
      });
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        while (!settled) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const parsed = JSON.parse(line) as HerdrResponse;
            if (parsed?.id === request.id) finish(parsed);
          } catch {
            // Ignore unrelated/non-response lines. The request timeout remains
            // the hard bound if no matching response arrives.
          }
        }
      });
      socket.on("end", () => finish(null));
    });
  }
}

function sessionRefParams(sessionRef: HerdrAgentSessionRef | undefined): Record<string, string> {
  if (sessionRef?.agentSessionPath) {
    return { agent_session_path: sessionRef.agentSessionPath };
  }
  if (sessionRef?.agentSessionId) {
    return { agent_session_id: sessionRef.agentSessionId };
  }
  return {};
}
