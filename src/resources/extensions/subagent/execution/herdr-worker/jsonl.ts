import { StringDecoder } from "node:string_decoder";

export interface JsonlLineFramerOptions {
  onLine(line: string): void;
}

/**
 * UTF-8 aware line framer for GSD JSON-mode stdout. It does not parse JSON and
 * therefore cannot mutate or discard the raw artifact stream. Empty lines are
 * ignored for the semantic relay; malformed/non-JSON lines remain available in
 * stdout.jsonl and can be ignored safely by higher-level consumers.
 */
export class JsonlLineFramer {
  private readonly decoder = new StringDecoder("utf8");
  private readonly onLine: (line: string) => void;
  private buffer = "";

  constructor(options: JsonlLineFramerOptions) {
    this.onLine = options.onLine;
  }

  push(chunk: Buffer | Uint8Array | string): void {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(Buffer.from(chunk));
    this.flushCompleteLines();
  }

  end(): void {
    this.buffer += this.decoder.end();
    this.flushCompleteLines();
    const finalLine = this.buffer.trimEnd();
    this.buffer = "";
    if (finalLine.trim()) this.onLine(finalLine);
  }

  private flushCompleteLines(): void {
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) this.onLine(line);
    }
  }
}

export function parseJsonlRecord(line: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
