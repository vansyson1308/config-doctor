// Bounded-concurrency map with an optional time budget, so actions stay inside Forge's 55 s limit.
export interface PoolResult<R> {
  results: Array<R | undefined>;
  completed: number;
  timedOut: boolean;
}

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  deadlineMs?: number,
): Promise<PoolResult<R>> {
  const results: Array<R | undefined> = new Array(items.length);
  let next = 0;
  let completed = 0;
  let timedOut = false;
  async function worker(): Promise<void> {
    while (next < items.length) {
      if (deadlineMs !== undefined && Date.now() > deadlineMs) { timedOut = true; return; }
      const i = next++;
      results[i] = await fn(items[i] as T, i);
      completed++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { results, completed, timedOut };
}
