import { ZodError } from 'zod';
import { assertLocalDemo, getRuntimeConfig } from './config';
import { HttpError } from './errors';

export const privateHeaders = {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff',
};

/** Both checks matter: a valid configured origin is not permission to post to another Host. */
export function assertSameOrigin(request: Request, configuredOrigin?: string): void {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || (configuredOrigin && origin !== configuredOrigin)
    || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Same-origin request required');
}

export function mutationOrigin(request: Request): string {
  const config = getRuntimeConfig();
  assertLocalDemo(request);
  assertSameOrigin(request, config?.baseUrl);
  return config?.baseUrl ?? new URL(request.url).origin;
}

/** Read the actual stream with a hard cap; Content-Length alone is untrusted. */
export async function readBytes(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new HttpError(413, 'Request body too large');
  if (!request.body) throw new HttpError(400, 'Request body required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, 'Request body too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJson(request: Request, limit = 128 * 1024): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Expected application/json');
  }
  const bytes = await readBytes(request, limit);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, 'Invalid JSON'); }
}

export async function jsonEndpoint(work: () => Promise<unknown>): Promise<Response> {
  try {
    const result = await work();
    if (result instanceof Response) {
      const headers = new Headers(result.headers);
      for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
      return new Response(result.body, { status: result.status, headers });
    }
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    // Never serialize SQL, credentials, request bodies, capability tokens, or Zod input values.
    const status = error instanceof HttpError ? error.status : error instanceof ZodError ? 400 : 503;
    const message = error instanceof HttpError ? error.message : error instanceof ZodError ? 'Invalid request' : 'Service temporarily unavailable';
    return Response.json({ error: message }, { status, headers: { ...privateHeaders, ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
  }
}