import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HerdrWorkerActivityArtifactBatcher } from "../activity-artifact-batcher.js";

describe("Herdr activity artifact batching", () => {
  it("writes the latest activity once within 250ms without postponing for new activity", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let latest = "first";
    const writes: string[] = [];
    const batcher = new HerdrWorkerActivityArtifactBatcher(() => writes.push(latest), 250);
    for (let index = 0; index < 100; index++) batcher.schedule();
    t.mock.timers.tick(249);
    assert.deepEqual(writes, []);
    latest = "latest";
    batcher.schedule();
    t.mock.timers.tick(1);
    assert.deepEqual(writes, ["latest"]);
    t.mock.timers.tick(500);
    assert.deepEqual(writes, ["latest"]);
    latest = "next window";
    batcher.schedule();
    t.mock.timers.tick(250);
    assert.deepEqual(writes, ["latest", "next window"]);
  });

  it("allows heartbeat flush and lifecycle cancellation without a stale timer write", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let writes = 0;
    const batcher = new HerdrWorkerActivityArtifactBatcher(() => writes++, 10);
    batcher.schedule();
    assert.equal(batcher.flush(), true);
    assert.equal(batcher.flush(), false);
    batcher.schedule();
    batcher.cancel();
    t.mock.timers.tick(20);
    assert.equal(writes, 1);
  });

  it("retains failed activity writes for retry and does not hide synchronous flush failures", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let failing = true;
    let attempts = 0;
    const batcher = new HerdrWorkerActivityArtifactBatcher(() => {
      attempts++;
      if (failing) throw new Error("Unsafe artifact parent");
    }, 250);
    batcher.schedule();
    assert.doesNotThrow(() => t.mock.timers.tick(250));
    assert.throws(() => batcher.flush(), /Unsafe artifact parent/);
    failing = false;
    assert.equal(batcher.flush(), true);
    assert.equal(attempts, 3);
    assert.equal(batcher.flush(), false);
  });
});
