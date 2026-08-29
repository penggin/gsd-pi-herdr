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
  mode: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return mode === "tui" && detectHerdrEnvironment(env).available && !isHerdrSubagentChild(env);
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
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;

        const line = buffer.slice(0, newline).trim();
        if (!line) return;
        try {
          const parsed = JSON.parse(line) as HerdrResponse;
          if (parsed?.id === request.id) finish(parsed);
        } catch {
          finish(null);
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
