/** Coalesce diagnostic activity; lifecycle and final writes bypass this scheduler. */
export class HerdrWorkerActivityArtifactBatcher {
  private readonly write: () => void;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;

  constructor(write: () => void, intervalMs: number) {
    this.write = write;
    this.intervalMs = intervalMs;
  }

  schedule(): void {
    this.pending = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      try { this.flush(); } catch {
        // Keep the update pending for the next activity/heartbeat boundary.
        // Final state publication still requires the secure writer to succeed.
      }
    }, this.intervalMs);
    this.timer.unref?.();
  }

  flush(): boolean {
    if (!this.pending) return false;
    this.clearTimer();
    this.write();
    this.pending = false;
    return true;
  }

  cancel(): void {
    this.clearTimer();
    this.pending = false;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
