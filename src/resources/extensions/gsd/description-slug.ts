import { createHash } from "node:crypto";

/** Keep readable ASCII slugs, with a stable token for Unicode-only descriptions. */
export function slugifyDescription(text: string, maxLength: number): string {
  const normalized = text.normalize("NFC").trim().toLowerCase();
  const ascii = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  if (ascii) return ascii;
  if (!/[\p{L}\p{N}]/u.test(normalized)) return "";

  // This identifies the description; callers still allocate task numbers or
  // collision suffixes when separate tasks have the same token.
  const token = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `task-${token}`.slice(0, maxLength);
}
