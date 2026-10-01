import { z } from 'zod';
import { getAuth, normalizePhoneUsername, phonePattern, requireAdmin } from '@/server/auth';
import { getRuntimeConfig } from '@/server/config';
import { HttpError } from '@/server/errors';
import { jsonEndpoint, mutationOrigin, readJson } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const login = z.object({
  username: z.string().max(16).transform(normalizePhoneUsername).pipe(z.string().regex(phonePattern)), password: z.string().min(1).max(128),
  rememberMe: z.boolean().optional(), callbackURL: z.string().max(2048).optional(),
}).strict();

async function handle(request: Request) {
  return jsonEndpoint(async () => {
    getRuntimeConfig();
    const path = new URL(request.url).pathname;
    const isLogin = request.method === 'POST' && path === '/api/auth/sign-in/username';
    const isLogout = request.method === 'POST' && path === '/api/auth/sign-out';
    const isSession = request.method === 'GET' && path === '/api/auth/get-session';
    // An allowlist also disables future plugin routes, not just today's known signup paths.
    if (!isLogin && !isLogout && !isSession) throw new HttpError(404, 'Not found');
    if (request.method === 'POST') mutationOrigin(request);
    let forwarded = request;
    if (isLogin) {
      await rateLimit('auth:login', 30, 900);
      const body = login.parse(await readJson(request, 8192));
      if (body.callbackURL) {
        const callback = new URL(body.callbackURL, new URL(request.url).origin);
        if (callback.origin !== new URL(request.url).origin || callback.username || callback.password) throw new HttpError(400, 'Invalid callback URL');
      }
      forwarded = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) });
    } else {
      await requireAdmin(request);
      await rateLimit('auth:session', 120);
      if (isLogout) {
        // Sign-out has no user input. Reject oversized bodies rather than forwarding unbounded data.
        await readJson(request, 1024);
        forwarded = new Request(request.url, { method: 'POST', headers: request.headers, body: '{}' });
      }
    }
    const response = await getAuth().handler(forwarded);
    if (!response.ok) {
      const status = response.status >= 500 ? 503 : response.status;
      throw new HttpError(status, status === 401 ? 'Invalid phone or password' : status === 429 ? 'Too many requests; try again later' : 'Authentication request failed');
    }
    return response;
  });
}
export const GET = handle;
export const POST = handle;