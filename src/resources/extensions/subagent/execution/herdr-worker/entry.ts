import {
  herdrWorkerRuntimeRoot,
  inferHerdrWorkerRuntimeRootFromLaunchPath,
  readHerdrWorkerLaunchSpec,
  type HerdrWorkerArtifactPaths,
  type HerdrWorkerLaunchSpecV1,
} from "./artifacts.js";
import { runHerdrWorker } from "./runner.js";
import { gsdHome } from "../../../gsd/gsd-home.js";

export const HERDR_WORKER_INTERNAL_COMMAND = "__herdr-worker";

export interface HerdrWorkerCliDependencies {
  run?: (spec: HerdrWorkerLaunchSpecV1, paths: HerdrWorkerArtifactPaths) => Promise<number>;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  runtimeRoot?: string;
}

export function isHerdrWorkerInvocation(args: string[]): boolean {
  return args[0] === HERDR_WORKER_INTERNAL_COMMAND;
}

export async function runHerdrWorkerCli(
  args: string[],
  dependencies: HerdrWorkerCliDependencies = {},
): Promise<number> {
  const stderr = dependencies.stderr ?? process.stderr;
  if (!isHerdrWorkerInvocation(args) || args.length !== 2 || !args[1]) {
    stderr.write("[gsd-herdr-worker] invalid internal worker invocation\n");
    return 2;
  }

  try {
    const launchPath = args[1];
    const inferredRuntimeRoot = inferHerdrWorkerRuntimeRootFromLaunchPath(launchPath);
    const runtimeRoot = dependencies.runtimeRoot ?? herdrWorkerRuntimeRoot(gsdHome());
    if (inferredRuntimeRoot !== runtimeRoot) {
      throw new Error("Herdr worker launch spec is outside the configured GSD runtime root");
    }
    const { spec, paths } = readHerdrWorkerLaunchSpec(launchPath, runtimeRoot);
    return await (dependencies.run ?? runHerdrWorker)(spec, paths);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`[gsd-herdr-worker] ${boundedDiagnostic(message)}\n`);
    return 2;
  }
}

function boundedDiagnostic(value: string): string {
  const singleLine = value.replace(/[\r\n]+/g, " ").trim();
  return singleLine.length <= 240 ? singleLine : `${singleLine.slice(0, 239)}…`;
}
