// Test-only expected delta from the sealed schema-v48 corpus to current v49.
// Retained database bytes, oracle files, and their hashes remain unchanged.

import assert from "node:assert/strict";
import type { LegacyImportPreviewDiagnosis, LegacyImportPreviewResolution, LegacyImportPreviewSource } from "../../legacy-import-contract.ts";
import { hashLegacyImportBytes, hashLegacyImportValue } from "../../legacy-import-preview.ts";

export function historicalV48Expectation(source: LegacyImportPreviewSource, bytes: Buffer): {
  diagnosis: LegacyImportPreviewDiagnosis;
  resolution: LegacyImportPreviewResolution;
} {
  assert.equal(source.kind, "sqlite-database");
  assert.equal(bytes.subarray(0, 16).toString("utf8"), "SQLite format 3\0");
  const identity = {
    code: "historical-schema-version",
    severity: "info" as const,
    source_id: source.source_id,
    locator: { start_byte: 0, end_byte: 16 },
    raw_value: { redacted: true as const, sha256: hashLegacyImportBytes(bytes.subarray(0, 16)) },
    message: "Schema v48 is a supported historical database target.",
  };
  const diagnosis = { diagnosis_id: hashLegacyImportValue(identity), ...identity };
  return {
    diagnosis,
    resolution: {
      diagnosis_id: diagnosis.diagnosis_id,
      disposition: "mapped",
      target: { kind: "database-target", key: source.path },
    },
  };
}
