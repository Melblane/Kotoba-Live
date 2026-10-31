import { ProviderError, type ProviderErrorCode } from './types.js';

async function classify(res: Response): Promise<ProviderError> {
  const body = await res.text().catch(() => '');
  let code: ProviderErrorCode = 'PROVIDER';
  if (res.status === 401 || res.status === 403) code = 'AUTH';
  else if (res.status === 429) {
    code = /insufficient_quota|exceeded your current quota|billing|credit/i.test(body) ? 'QUOTA_EXCEEDED' : 'RATE_LIMITED';
  }
  const retryAfter = Number(res.headers.get('retry-after'));
  // Provider bodies stay in the server log; clients only get a generic message.
  console.warn(`[provider] HTTP ${res.status}: ${body.slice(0, 300)}`);
  return new ProviderError(code, `Provider responded with HTTP ${res.status}`, res.status, retryAfter > 0 ? retryAfter * 1000 : undefined);
}

export async function providerFetch(url: string, init: RequestInit, opts: { signal?: AbortSignal; timeoutMs: number }): Promise<Response> {
  const signals: AbortSignal[] = [AbortSignal.timeout(opts.timeoutMs)];
  if (opts.signal) signals.push(opts.signal);
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
    if (!res.ok) throw await classify(res);
    return res;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (opts.signal?.aborted) throw new ProviderError('ABORTED', 'Request aborted');
    if (err instanceof Error && err.name === 'TimeoutError') throw new ProviderError('TIMEOUT', 'Provider timed out');
    throw new ProviderError('PROVIDER', 'Could not reach the provider');
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retries once for transient failures. Quota, auth and aborts are never retried. */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    if (!['RATE_LIMITED', 'PROVIDER', 'TIMEOUT'].includes(err.code) || signal?.aborted) throw err;
    await sleep(Math.min(err.retryAfterMs ?? 800, 2500));
    if (signal?.aborted) throw new ProviderError('ABORTED', 'Request aborted');
    return fn();
  }
}
