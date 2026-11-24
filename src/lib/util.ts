// Small helpers shared by the pipeline steps.

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Runs fn over items with at most `limit` in flight, keeping order.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// fetch with retries for rate limits, 5xx and network errors.
export async function fetchRetry(url: string, init: RequestInit = {}, tries = 5, timeoutMs = 120_000): Promise<Response> {
  let wait = 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt < tries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : wait);
        wait *= 2;
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= tries) throw err;
      await sleep(wait);
      wait *= 2;
    }
  }
}

export const now = () => Math.floor(Date.now() / 1000);
