// At most one read in flight. Events arriving during it become one follow-up,
// so a save is still refreshed without a burst of competing full-store reads.
export function coalesceRefresh(run: (quiet: boolean, full: boolean) => Promise<void>) {
  let active: Promise<void> | null = null;
  let pending: { quiet: boolean; full: boolean } | null = null;
  return (quiet = false, full = false): Promise<void> => {
    pending = { quiet: (pending?.quiet ?? true) && quiet, full: (pending?.full ?? false) || full };
    if (!active) {
      active = (async () => {
        await Promise.resolve();
        try {
          while (pending) {
            const next = pending;
            pending = null;
            await run(next.quiet, next.full);
          }
        } finally { active = null; pending = null; }
      })();
    }
    return active;
  };
}
