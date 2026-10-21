export class AppError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}

export async function boundedFetch(url, options = {}, fetcher = fetch, limit = 1024 * 1024) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000), ...options, redirect: 'error' });
  if (!response.ok) throw new AppError('upstream', response.status === 404 ? 404 : 502);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new AppError('oversized');
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks), type: response.headers.get('content-type') || '' };
}

export function singleFlight(loader, ttl, clock = Date.now, key = () => '') {
  let value, expires = 0, pending, lastKey;
  return async function get() {
    const nextKey = key();
    if (value !== undefined && expires > clock() && lastKey === nextKey) return value;
    if (!pending) pending = loader().then(result => {
      value = result; lastKey = nextKey; expires = clock() + ttl; return result;
    }).finally(() => { pending = null; });
    return pending;
  };
}
