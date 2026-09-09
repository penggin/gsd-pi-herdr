import { redactSecrets } from "./redact-secrets.js";

/** Keep log line coordinates stable even when a multiline secret is removed. */
export function redactExecLog(text: string): string {
  // A capped prefix can end inside one of the existing redactor's PEM shapes.
  // Complete only that known shape for redaction, never return synthetic data.
  const begin = /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/g;
  const end = /-----END\s+(RSA|DSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/g;
  let match: RegExpExecArray | null;
  // Two linear passes, not one suffix scan for every BEGIN in a noisy log.
  let afterLastEnd = 0;
  while ((match = end.exec(text))) afterLastEnd = match.index + match[0].length;
  begin.lastIndex = afterLastEnd;
  const unterminated = begin.exec(text);
  const input = unterminated ? `${text}-----END ${unterminated[1]} PRIVATE KEY-----` : text;
  return redactSecrets(input, { preserveLines: true });
}

/** A saved byte prefix must not manufacture a broken final UTF-8 code point. */
export function decodeExecUtf8(bytes: Uint8Array, complete = true): string {
  return new TextDecoder("utf-8").decode(bytes, { stream: !complete });
}

/** Bound text without splitting a surrogate pair. Counts UTF-16 chars, not tokens. */
export function sliceExecText(text: string, maxChars: number): string {
  let end = Math.max(0, Math.min(text.length, Math.floor(maxChars)));
  if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return text.slice(0, end);
}

/** Redact outward structured strings without changing the paths used for I/O. */
export function redactExecDetails<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map(item => redactExecDetails(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactExecDetails(item)])) as T;
  }
  return value;
}
