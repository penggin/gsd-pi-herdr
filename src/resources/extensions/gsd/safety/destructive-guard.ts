/**
 * Destructive command classifier for auto-mode safety harness.
 * Classifies bash commands and warns on potentially destructive operations.
 * Does NOT block — only classifies for logging/notification.
 *
 * Copyright (c) 2026 Jeremy McSpadden <jeremy@fluxlabs.net>
 */

// ─── Pattern Definitions ────────────────────────────────────────────────────

interface DestructivePattern {
  pattern: RegExp;
  label: string;
}

const DESTRUCTIVE_PATTERNS: readonly DestructivePattern[] = [
  { pattern: /\brm\s+((?:-(?!-)[^\s]*[rR][^\s]*|--recursive)\s+|.*\s+(?:-(?!-)[^\s]*[rR][^\s]*|--recursive)(?:\s|$))/, label: "recursive delete" },
  { pattern: /\bgit\s+push\s+.*--force/, label: "force push" },
  { pattern: /\bgit\s+push\s+-f\b/, label: "force push" },
  { pattern: /\bgit\s+reset\s+--hard/, label: "hard reset" },
  { pattern: /\bgit\s+clean\s+-[^\s]*[fdxFDX]/, label: "git clean" },
  { pattern: /\bgit\s+checkout\s+--\s+\./, label: "discard all changes" },
  { pattern: /\bdrop\s+(database|table|index)\b/i, label: "SQL drop" },
  { pattern: /\btruncate\s+table\b/i, label: "SQL truncate" },
  { pattern: /\bchmod\s+777\b/, label: "world-writable permissions" },
  { pattern: /\bcurl\s.*\|\s*(bash|sh|zsh)\b/, label: "pipe to shell" },
  { pattern: /\bterra(form|grunt)\s+(apply|destroy)/i, label: "IaC apply/destroy" },
  { pattern: /\baws\s+\w+\s+(delete|create|put|remove|terminate)\b/i, label: "AWS mutation" },
  { pattern: /\bkubectl\s+(delete|apply)\b/i, label: "kubectl mutation" },
];

function stripQuotedAndComments(command: string): string {
  return command
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/(^|\s)#.*$/g, "$1");
}

function extractShellCommandPayloads(command: string): string[] {
  const payloads: string[] = [];
  const pattern = /\b(?:bash|sh|zsh)\s+-[A-Za-z]*c[A-Za-z]*\s+(["'])([\s\S]*?)\1/g;
  for (const match of command.matchAll(pattern)) {
    if (match[2]) payloads.push(match[2]);
  }
  return payloads;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface CommandClassification {
  destructive: boolean;
  labels: string[];
}

/**
 * Classify a bash command for destructive operations.
 * Returns the list of matched destructive pattern labels.
 */
export function classifyCommand(command: string): CommandClassification {
  const commandsToClassify = [stripQuotedAndComments(command), ...extractShellCommandPayloads(command)];
  const labels: string[] = [];
  for (const commandToClassify of commandsToClassify) {
    for (const { pattern, label } of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(stripQuotedAndComments(commandToClassify))) {
        // Deduplicate labels (e.g., two force-push patterns)
        if (!labels.includes(label)) labels.push(label);
      }
    }
  }
  return { destructive: labels.length > 0, labels };
}
