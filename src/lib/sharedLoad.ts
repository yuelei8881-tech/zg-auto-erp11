// Consumers wait on one preload; clicking must not enqueue another full read.
// Clear on success AND failure so an explicit retry can recover.
export function sharedLoad<T>(load: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  return (): Promise<T> => {
    if (!pending) pending = Promise.resolve().then(load).finally(() => { pending = null; });
    return pending;
  };
}
