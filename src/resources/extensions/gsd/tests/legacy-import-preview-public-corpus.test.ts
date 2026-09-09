// Project/App: gsd-pi
// File Purpose: Public Preview replay, validation, and read-only gates across the sealed legacy corpus.

import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import type { LegacyImportPreviewEnvelope } from "../legacy-import-contract.ts";
import { LEGACY_IMPORT_BASE_DATABASE_SCHEMA_VERSION } from "../legacy-import-contract.ts";
import {
  canonicalLegacyImportJson,
  createLegacyImportPreview,
  hashLegacyImportBytes,
  hashLegacyImportValue,
  revalidateLegacyImportPreview,
  type LegacyImportPreviewCreateInput,
} from "../legacy-import-preview.ts";
import { _getAdapter, closeDatabase, insertDecision, openDatabase } from "../gsd-db.ts";
import {
  createLegacyImportCorpusSourceRoots,
  fingerprintLegacyImportCorpusTree,
  loadLegacyImportCorpusCase,
  validateLegacyImportCorpusCase,
  type LegacyImportCorpusManifest,
} from "./helpers/legacy-import-corpus.ts";
import { historicalV48Expectation } from "./helpers/legacy-import-schema-49-expectations.ts";

const CORPUS_ROOT = new URL("./__fixtures__/legacy-import-corpus/v1/", import.meta.url);
const CORPUS_PATH = fileURLToPath(CORPUS_ROOT);
const MANIFEST = JSON.parse(readFileSync(join(CORPUS_PATH, "corpus.json"), "utf8")) as LegacyImportCorpusManifest;

const DEVIATIONS = {
  "action-matrix": {
    reason: "state-narrative-preservation",
    counts: [1, 1, 1, 1, 0, 0],
    semantic_hash: "sha256:fa53b64a57678d873ec1b39d3f2e18ed66f4b1faf0c428405f2db2063fb575e9",
  },
  "assessment-matrix": {
    reason: "empty-base-create",
    counts: [9, 0, 0, 10, 3, 6],
    semantic_hash: "sha256:a209bc009f0d442c74b1aeb0469735dd69efc5099653794ed61f0c126be66f74",
  },
  "composite-capstone": {
    reason: "multi-target-completeness",
    counts: [5, 0, 0, 5, 3, 5],
    semantic_hash: "sha256:3989cd22a325b8c776c62a47965d13e03b968eefc3c71aaf5af3f7c1246ce5a8",
  },
  "db-target-matrix": {
    reason: "multi-target-ambiguity",
    counts: [0, 0, 0, 0, 2, 3],
    semantic_hash: "sha256:9992a2d587dd6ab1138fae554a19e40a42da31d4436f07d40ad1826004e40b5c",
  },
  "gsd-flat": {
    reason: "empty-base-create-instead-of-update",
    counts: [8, 0, 0, 1, 1, 1],
    semantic_hash: "sha256:b5ed8b478e2edb729a94263b0e549ea7207a9c2061d3f94bac3403c4320f435f",
  },
  "lifecycle-truth-matrix": {
    reason: "t06-conflicting-completeness",
    counts: [7, 0, 0, 7, 2, 11],
    semantic_hash: "sha256:1678c8d48f46463db3561af827cce793182cfdfad65b4f0c7d062d9fd8f07929",
  },
  "planning-flat-complete": {
    reason: "empty-base-create-instead-of-update",
    counts: [5, 0, 0, 0, 0, 0],
    semantic_hash: "sha256:4f2f0c2152f1b6af03576be913066491a16b3c9478c1bcbdab873eae8fea5251",
  },
  "planning-loss-surfaces": {
    reason: "t06-unscoped-planning-preservation",
    counts: [0, 0, 0, 13, 0, 7],
    semantic_hash: "sha256:6da2628f15d6966193c2a83641ef85f71dcfa4438e2b0bfb742754ffe3722e78",
  },
  "synthetic-smoke": {
    reason: "validator-only-case",
    counts: [0, 0, 0, 1, 0, 0],
    semantic_hash: "sha256:9f21fcfce6e5572d833f3bea885708528e86cc9e0f17281cbd90eeab7fdfa4d3",
  },
} as const;

const READ_ONLY_CANONICAL_TABLES = [
  "project_authority",
  "workflow_operations",
  "workflow_domain_events",
  "workflow_outbox",
  "workflow_projection_work",
  "workflow_import_applications",
  "workflow_settlement_receipts",
  "command_queue",
  "workers",
  "unit_dispatches",
  "milestone_leases",
  "cancellation_requests",
  "turn_git_transactions",
] as const;

function sortCanonical<T>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => canonicalLegacyImportJson(left).localeCompare(canonicalLegacyImportJson(right)));
}

function canonicalTableSnapshots(database: NonNullable<ReturnType<typeof _getAdapter>>): Record<string, string> {
  return Object.fromEntries(READ_ONLY_CANONICAL_TABLES.map((table) => [
    table,
    hashLegacyImportValue(sortCanonical(database.prepare(`SELECT * FROM "${table}"`).all())),
  ]));
}

function semanticProjection(preview: LegacyImportPreviewEnvelope): unknown {
  const paths = new Map(preview.sources.map((source) => [source.source_id, source.path]));
  const diagnosisKeys = new Map(preview.diagnoses.map(({ diagnosis_id: diagnosisId, source_id: sourceId, ...diagnosis }) => [
    diagnosisId,
    canonicalLegacyImportJson({ ...diagnosis, source_id: paths.get(sourceId) }),
  ]));
  return {
    counts: preview.counts,
    sources: sortCanonical(preview.sources.map(({ source_id: _sourceId, ...source }) => source)),
    changes: sortCanonical(preview.changes.map(({ change_id: _changeId, ...change }) => ({
      ...change,
      raw: { ...change.raw, source_id: paths.get(change.raw.source_id) },
      provenance: { ...change.provenance, source_id: paths.get(change.provenance.source_id) },
    }))),
    diagnoses: sortCanonical(preview.diagnoses.map(({ diagnosis_id: _diagnosisId, source_id: sourceId, ...diagnosis }) => ({
      ...diagnosis,
      source_id: paths.get(sourceId),
    }))),
    resolutions: sortCanonical(preview.resolutions.map(({ diagnosis_id: diagnosisId, ...resolution }) => ({
      ...resolution,
      diagnosis: diagnosisKeys.get(diagnosisId),
    }))),
  };
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function actionKeys(preview: LegacyImportPreviewEnvelope): string[] {
  return preview.changes.map((change) => [
    change.action,
    change.target.kind,
    change.target.key,
    change.target.field,
  ].filter((value) => value !== undefined).join(":"))
    .sort();
}

function seedActionMatrixBase(source: string): void {
  const fixture = new DatabaseSync(join(source, ".gsd", "gsd.db"), { readOnly: true });
  try {
    const rows = fixture.prepare(`
      SELECT id, when_context, scope, decision, choice, rationale, revisable,
             made_by, source, superseded_by
      FROM decisions
      WHERE id IN ('D002', 'D003', 'D004')
      ORDER BY id
    `).all() as unknown as Array<Parameters<typeof insertDecision>[0]>;
    assert.deepEqual(rows.map((row) => row.id), ["D002", "D003", "D004"]);
    rows.forEach(insertDecision);
  } finally {
    fixture.close();
  }
}

test("public legacy Preview returns deterministic read-only artifacts for every corpus case", (t) => {
  assert.equal(MANIFEST.cases.length, 26);
  const directory = mkdtempSync(join(tmpdir(), "gsd-public-corpus-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const results = new Map<string, LegacyImportPreviewEnvelope>();

  for (const entry of MANIFEST.cases) {
    const corpusCase = loadLegacyImportCorpusCase(CORPUS_ROOT, entry.name);
    // Keep validating the sealed v48 oracle against its unchanged historical
    // schema. Only newly generated Preview documents use the current version.
    validateLegacyImportCorpusCase(corpusCase);
    const currentSchema = structuredClone(corpusCase.schema) as { properties: Record<string, unknown> };
    assert.deepEqual(currentSchema.properties.base_database_schema_version, { const: 48 });
    currentSchema.properties.base_database_schema_version = { const: LEGACY_IMPORT_BASE_DATABASE_SCHEMA_VERSION };
    const caseRoot = join(directory, entry.name);
    const source = join(caseRoot, "source");
    const databasePath = join(caseRoot, "canonical.db");
    cpSync(join(CORPUS_PATH, entry.name, "source"), source, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
    assert.equal(openDatabase(databasePath), true, entry.name);
    try {
      const database = _getAdapter();
      assert.ok(database);
      if (entry.name === "action-matrix") seedActionMatrixBase(source);
      const input: LegacyImportPreviewCreateInput = {
        roots: createLegacyImportCorpusSourceRoots(source),
        ...(entry.name === "custom-workflow" ? { bundledDefinitionNames: ["bugfix"] } : {}),
      };
      const sourceBefore = fingerprintLegacyImportCorpusTree(source);
      const canonicalTablesBefore = canonicalTableSnapshots(database);
      const totalChangesBefore = database.prepare("SELECT total_changes() AS count").get()?.["count"];
      const databaseBefore = hashLegacyImportBytes(readFileSync(databasePath));
      const caseRootBefore = fingerprintLegacyImportCorpusTree(caseRoot);
      const first = createLegacyImportPreview(input);
      const replay = createLegacyImportPreview(input);

      assert.deepEqual(replay, first, `${entry.name}: exact replay`);
      assert.deepEqual(
        [
          ...first.preview.changes.map((change) => [change.target, change.raw.locator] as const),
          ...first.preview.diagnoses.map((diagnosis) => [diagnosis.code, diagnosis.locator] as const),
        ].filter(([, locator]) => locator.end_byte === undefined || locator.end_byte <= locator.start_byte),
        [],
        `${entry.name}: non-empty exact evidence locators`,
      );
      assert.deepEqual(revalidateLegacyImportPreview(input, first), first, `${entry.name}: revalidate`);
      assert.equal(first.preview_hash, hashLegacyImportValue(first.preview), `${entry.name}: artifact hash`);
      assertDeepFrozen(first);
      assert.equal(first.preview.base_database_schema_version, LEGACY_IMPORT_BASE_DATABASE_SCHEMA_VERSION);
      validateLegacyImportCorpusCase({ ...corpusCase, schema: currentSchema, oracle: first.preview });
      assert.equal(first.preview.sources.length, corpusCase.files.length, `${entry.name}: exactly-once sources`);
      assert.equal(new Set(first.preview.sources.map((item) => item.path)).size, corpusCase.files.length, `${entry.name}: unique sources`);
      assert.equal(fingerprintLegacyImportCorpusTree(source), sourceBefore, `${entry.name}: source read-only`);
      assert.equal(hashLegacyImportBytes(readFileSync(databasePath)), databaseBefore, `${entry.name}: database read-only`);
      assert.equal(
        fingerprintLegacyImportCorpusTree(caseRoot),
        caseRootBefore,
        `${entry.name}: complete project inventory read-only`,
      );
      assert.deepEqual(canonicalTableSnapshots(database), canonicalTablesBefore, `${entry.name}: canonical tables read-only`);
      assert.equal(database.prepare("SELECT total_changes() AS count").get()?.["count"], totalChangesBefore, `${entry.name}: no writes`);

      const deviation = DEVIATIONS[entry.name as keyof typeof DEVIATIONS];
      if (deviation === undefined) {
        let expected = corpusCase.oracle;
        if (entry.name === "root-external-boundaries") {
          const source = expected.sources.find((candidate) => candidate.path === "$GSD_STATE_DIR/projects/project-external/gsd.db")!;
          const historical = historicalV48Expectation(source, corpusCase.files.find((file) => file.path === source.path)!.bytes);
          expected = {
            ...expected,
            diagnoses: [...expected.diagnoses, historical.diagnosis],
            resolutions: [...expected.resolutions, historical.resolution],
          };
        }
        assert.deepEqual(semanticProjection(first.preview), semanticProjection(expected), entry.name);
      } else {
        const expectedCounts = entry.name === "db-target-matrix"
          ? [0, 0, 0, 0, 1, 2] // Retained v49 is current: one fewer unsupported source/resolution.
          : entry.name === "lifecycle-truth-matrix"
            ? [7, 0, 0, 5, 2, 10] // Public dependency inspection requires the current schema.
            : deviation.counts;
        assert.deepEqual(Object.values(first.preview.counts), expectedCounts, `${entry.name}: ${deviation.reason}`);
        let retainedVersionSemantics = first.preview;
        if (["action-matrix", "db-target-matrix", "lifecycle-truth-matrix"].includes(entry.name)) {
          const historicalPath = entry.name === "db-target-matrix" ? "current-v48/.gsd/gsd.db" : ".gsd/gsd.db";
          const source = first.preview.sources.find((candidate) => candidate.path === historicalPath)!;
          const historical = historicalV48Expectation(source, corpusCase.files.find((file) => file.path === source.path)!.bytes);
          // Assert the complete new v48 diagnostic before comparing the rest
          // with the existing v48-era digest. No retained digest is regenerated.
          assert.deepEqual(first.preview.diagnoses.find((diagnosis) => diagnosis.diagnosis_id === historical.diagnosis.diagnosis_id), historical.diagnosis);
          assert.deepEqual(first.preview.resolutions.find((resolution) => resolution.diagnosis_id === historical.diagnosis.diagnosis_id), historical.resolution);
          retainedVersionSemantics = {
            ...first.preview,
            diagnoses: first.preview.diagnoses.filter((diagnosis) => diagnosis.diagnosis_id !== historical.diagnosis.diagnosis_id),
            resolutions: first.preview.resolutions.filter((resolution) => resolution.diagnosis_id !== historical.diagnosis.diagnosis_id),
          };
        }
        if (entry.name === "lifecycle-truth-matrix") {
          const retainedDb = new DatabaseSync(join(source, ".gsd", "gsd.db"), { readOnly: true });
          try {
            assert.equal(retainedDb.prepare("SELECT max(version) AS version FROM schema_version").get()?.version, 48);
          } finally {
            retainedDb.close();
          }
          assert.equal(LEGACY_IMPORT_BASE_DATABASE_SCHEMA_VERSION, 49);
          // The public producer inspects dependency rows only at its current
          // schema; v48 remains retained evidence. Lower-level parser corpus
          // tests still cover the conflict when supplied exact DB observations.
          const dependencyKeys = ["M001/S02/dependency-junction", "M001/S02/depends-column"];
          assert.deepEqual(first.preview.changes.filter((change) => dependencyKeys.includes(change.target.key)), []);
          assert.deepEqual(first.preview.diagnoses.filter((diagnosis) => diagnosis.code === "slices-depends-vs-slice-dependencies-conflict"), []);
          assert.deepEqual(first.preview.resolutions.filter((resolution) => resolution.target !== undefined && dependencyKeys.includes(resolution.target.key)), []);
          const currentSource = first.preview.sources.find((candidate) => candidate.path === ".gsd/gsd.db")!;
          const oldChanges = corpusCase.oracle.changes.filter((change) => dependencyKeys.includes(change.target.key));
          assert.deepEqual(oldChanges.map((change) => change.target.key).sort(), dependencyKeys);
          assert.ok(oldChanges.every((change) => change.action === "preserve" && change.reason_code === "dependency-conflict-raw-evidence"));
          const oldConflict = corpusCase.oracle.diagnoses.find((diagnosis) => diagnosis.code === "slices-depends-vs-slice-dependencies-conflict")!;
          const oldResolution = corpusCase.oracle.resolutions.find((resolution) => resolution.diagnosis_id === oldConflict.diagnosis_id)!;
          assert.deepEqual(oldResolution, { diagnosis_id: oldConflict.diagnosis_id, disposition: "requires-user" });
          // Reconstruct only the supplied-evidence entries for the original
          // digest; this adds no historical dependency-read support to runtime.
          retainedVersionSemantics = {
            ...retainedVersionSemantics,
            counts: { ...retainedVersionSemantics.counts, preserve: 7, unresolved: 11 },
            changes: [...retainedVersionSemantics.changes, ...oldChanges.map((change) => ({
              ...change,
              raw: { ...change.raw, source_id: currentSource.source_id },
              provenance: { ...change.provenance, source_id: currentSource.source_id },
            }))],
            diagnoses: [...retainedVersionSemantics.diagnoses, { ...oldConflict, source_id: currentSource.source_id }],
            resolutions: [...retainedVersionSemantics.resolutions, oldResolution],
          };
        }
        if (entry.name === "db-target-matrix") {
          const current = first.preview.sources.find((source) => source.path === "future-v49/.gsd/gsd.db")!;
          assert.equal(LEGACY_IMPORT_BASE_DATABASE_SCHEMA_VERSION, 49, "review the retained-v49 delta when the schema advances");
          assert.equal(current.outcome, "mapped");
          assert.deepEqual(first.preview.diagnoses.filter((diagnosis) => diagnosis.source_id === current.source_id), []);
          assert.deepEqual(first.preview.resolutions.filter((resolution) => resolution.target?.key === current.path), []);
          const oldSource = corpusCase.oracle.sources.find((source) => source.path === current.path)!;
          const oldFuture = corpusCase.oracle.diagnoses.find((diagnosis) => diagnosis.source_id === oldSource.source_id)!;
          assert.equal(oldFuture.code, "future-schema-version");
          // Having asserted v49's current classification, reconstruct only its
          // historical unsupported fields to retain the original semantic hash.
          retainedVersionSemantics = {
            ...retainedVersionSemantics,
            counts: { ...retainedVersionSemantics.counts, unparsed: 2, unresolved: 3 },
            sources: retainedVersionSemantics.sources.map((source) => source.source_id === current.source_id ? { ...source, outcome: "unparsed" as const } : source),
            diagnoses: [...retainedVersionSemantics.diagnoses, { ...oldFuture, source_id: current.source_id }],
            resolutions: [...retainedVersionSemantics.resolutions, { diagnosis_id: oldFuture.diagnosis_id, disposition: "unsupported" }],
          };
        }
        assert.equal(
          hashLegacyImportValue(semanticProjection(retainedVersionSemantics)),
          deviation.semantic_hash,
          `${entry.name}: exact ${deviation.reason} semantics`,
        );
      }
      results.set(entry.name, first.preview);
    } finally {
      closeDatabase();
    }
  }

  assert.deepEqual(actionKeys(results.get("action-matrix")!), [
    "create:decision:D001",
    "delete:decision:D003",
    "preserve:legacy-artifact:.gsd/STATE.md",
    "update:decision:D002",
  ]);
  assert.deepEqual(actionKeys(results.get("composite-capstone")!), [
    "create:assessment:M702/S01/run-uat",
    "create:milestone-status:M702",
    "create:milestone:M702",
    "create:requirement:R701",
    "create:slice:M702/S01",
    "preserve:legacy-knowledge-source:.gsd/KNOWLEDGE.md",
    "preserve:legacy-workflow-definition:.gsd/workflows/capstone.yaml",
    "preserve:legacy-workflow-event:.gsd/event-log.jsonl#L001",
    "preserve:legacy-workflow-run-artifact:.gsd/workflow-runs/capstone/run-001/GRAPH.yaml",
    "preserve:legacy-worktree-topology:canonical/M008",
  ].sort());
  const lifecycle = results.get("lifecycle-truth-matrix")!;
  assert.deepEqual(actionKeys(lifecycle), [
    "create:milestone:M001",
    "create:slice:M001/S02",
    "create:slice:M001/S03",
    "create:task-status:M001/S02/T01",
    "create:task-status:M001/S02/T02",
    "create:task:M001/S02/T01",
    "create:task:M001/S02/T02",
    "preserve:legacy-artifact:.gsd/milestones/M001/slices/S01/tasks/T01/T01-PLAN.md:narrative",
    "preserve:legacy-artifact:.gsd/milestones/M001/slices/S02/S02-SUMMARY.md:full_summary_md",
    "preserve:legacy-evidence:M001/S02/structured-status",
    "preserve:legacy-evidence:M001/structured-status",
    "preserve:legacy-evidence:M001/summary-status",
  ].sort());
  assert.deepEqual(lifecycle.diagnoses.map((diagnosis) => diagnosis.code).sort(), [
    "checkbox-only-completion-advisory",
    "conflicting-legacy-import-completeness",
    "conflicting-legacy-import-completeness",
    "conflicting-legacy-import-completeness",
    "conflicting-legacy-import-completeness",
    "conflicting-legacy-import-completeness",
    "conflicting-legacy-import-completeness",
    "conflicting-legacy-import-completeness",
    "historical-schema-version",
    "incomplete-success-signal",
    "markdown-task-full-summary-md-loss",
    "markdown-task-narrative-loss",
    "projection-conflicts-with-adopted-lifecycle",
    "projection-conflicts-with-adopted-lifecycle",
    "slice-summary-upgrades-unchecked-roadmap",
    "summary-overrides-unchecked-task",
    "task-summary-parent-conflict",
  ]);
  assert.deepEqual(
    sortCanonical(lifecycle.resolutions.map(({ diagnosis_id: _diagnosisId, ...resolution }) => resolution)),
    sortCanonical([
      { disposition: "mapped", target: { kind: "database-target", key: ".gsd/gsd.db" } },
      { disposition: "mapped", target: { kind: "milestone-status", key: "M002" } },
      { disposition: "mapped", target: { kind: "milestone-status", key: "M002" } },
      { disposition: "mapped", target: { kind: "slice-status", key: "M004/S01" } },
      { disposition: "mapped", target: { kind: "task-status", key: "M004/S01/T01" } },
      { disposition: "preserved", target: { kind: "legacy-artifact", key: ".gsd/milestones/M001/slices/S01/tasks/T01/T01-PLAN.md" } },
      { disposition: "preserved", target: { kind: "legacy-artifact", key: ".gsd/milestones/M001/slices/S02/S02-SUMMARY.md" } },
      { disposition: "requires-user" },
      { disposition: "requires-user" },
      { disposition: "requires-user" },
      { disposition: "requires-user", target: { kind: "milestone", key: "M002" } },
      { disposition: "requires-user", target: { kind: "milestone", key: "M003" } },
      { disposition: "requires-user", target: { kind: "slice", key: "M004/S01" } },
      { disposition: "requires-user", target: { kind: "task", key: "M001/S01/T01" } },
      { disposition: "requires-user", target: { kind: "task", key: "M001/S01/T02" } },
      { disposition: "requires-user", target: { kind: "task", key: "M004/S01/T01" } },
      { disposition: "requires-user", target: { kind: "task", key: "M004/S01/T02" } },
    ]),
  );
});
