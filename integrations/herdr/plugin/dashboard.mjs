import { formatStatus, scanWorkers, sessionSnapshot } from "./operations.mjs";

let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

while (!stopped) {
  try {
    const snapshot = await sessionSnapshot();
    process.stdout.write(`\u001b[2J\u001b[H${formatStatus(scanWorkers(), snapshot)}\n\nCtrl-C to close\n`);
  } catch (error) {
    process.stdout.write(`\u001b[2J\u001b[H[gsd-herdr-plugin] ${error instanceof Error ? error.message : String(error)}\n\nCtrl-C to close\n`);
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
}

