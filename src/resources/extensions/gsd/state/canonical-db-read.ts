import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { DbAdapter } from "../db-adapter.js";
import { openWorkflowDatabaseIsolated, resolveProjectRootDbPath } from "../db-workspace.js";
import { readIndependentDatabaseTransaction, SCHEMA_VERSION, SchemaTooNewError } from "../db/engine.js";
import { captureStateDerivationScope, type StateDerivationScope } from "./derive/reader.js";

export class ProjectSnapshotReadError extends Error {
  override readonly name = "ProjectSnapshotReadError";
  readonly code: "db_unavailable" | "snapshot_too_large";
  constructor(code: ProjectSnapshotReadError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export interface CanonicalProjectReadOptions {
  /** Caller-owned read-only adapter, required to target this project's database. */
  adapter?: DbAdapter;
  /** Defaults to captured execution scope; an empty object reads the whole project. */
  scope?: StateDerivationScope;
}

/** Execution locks belong to the session's project, not an explicit foreign target. */
export function projectReadOptionsForTarget(targetBasePath: string, sessionBasePath: string): CanonicalProjectReadOptions {
  const canonicalDb = (basePath: string): string => {
    const path = resolveProjectRootDbPath(basePath);
    try { return realpathSync(path); } catch { return resolve(path); }
  };
  return { scope: canonicalDb(targetBasePath) === canonicalDb(sessionBasePath) ? captureStateDerivationScope() : {} };
}

export interface ProjectSnapshotAuthority {
  projectId: string;
  schemaVersion: number;
  revision: number;
  authorityEpoch: number;
}

export interface CanonicalProjectReadContext {
  adapter: DbAdapter;
  authority: ProjectSnapshotAuthority;
  scope: StateDerivationScope;
}

function requireAuthority(adapter: DbAdapter): ProjectSnapshotAuthority {
  const version = Number(adapter.prepare("SELECT MAX(version) AS version FROM schema_version").get()?.version);
  if (version > SCHEMA_VERSION) throw new SchemaTooNewError(version, SCHEMA_VERSION);
  if (version !== SCHEMA_VERSION) {
    throw new ProjectSnapshotReadError("db_unavailable", `Project snapshot requires schema v${SCHEMA_VERSION}; found v${version}. Open the project normally to migrate before reading.`);
  }
  const row = adapter.prepare("SELECT project_id, revision, authority_epoch FROM project_authority WHERE singleton = 1").get();
  const revision = Number(row?.revision);
  const authorityEpoch = Number(row?.authority_epoch);
  if (!row || typeof row.project_id !== "string" || !row.project_id.trim()
    || !Number.isSafeInteger(revision) || revision < 0
    || !Number.isSafeInteger(authorityEpoch) || authorityEpoch < 0) {
    throw new ProjectSnapshotReadError("db_unavailable", "GSD project authority is not available or is invalid");
  }
  return { projectId: row.project_id, schemaVersion: version, revision, authorityEpoch };
}

/** One caller-owned SQLite snapshot; never opens, replaces, or migrates the global DB. */
export function readCanonicalProjectDb<T>(
  basePath: string,
  options: CanonicalProjectReadOptions,
  read: (context: CanonicalProjectReadContext) => T,
): T | null {
  const requestedPath = resolveProjectRootDbPath(basePath);
  let canonicalPath: string;
  try { canonicalPath = realpathSync(requestedPath); } catch { return null; }
  const adapter = options.adapter ?? openWorkflowDatabaseIsolated(canonicalPath);
  if (!adapter) {
    if (!existsSync(requestedPath)) return null;
    throw new ProjectSnapshotReadError("db_unavailable", "The requested GSD project database exists but is not available for a consistent read");
  }
  try {
    const file = adapter.prepare("PRAGMA database_list").all().find((row) => row.name === "main")?.file;
    if (typeof file !== "string" || realpathSync(file) !== canonicalPath
      || adapter.prepare("PRAGMA query_only").get()?.query_only !== 1) {
      throw new ProjectSnapshotReadError("db_unavailable", "Project snapshot requires a read-only adapter for the requested project database");
    }
    const scope = { ...(options.scope ?? captureStateDerivationScope()) };
    return readIndependentDatabaseTransaction(adapter, () => read({
      adapter,
      authority: requireAuthority(adapter),
      scope,
    }), (error) => { throw error; });
  } catch (error) {
    if (error instanceof ProjectSnapshotReadError || error instanceof SchemaTooNewError) throw error;
    throw new ProjectSnapshotReadError("db_unavailable", "GSD project snapshot is not available; its database could not be read consistently", { cause: error });
  } finally {
    if (!options.adapter) adapter.close();
  }
}
