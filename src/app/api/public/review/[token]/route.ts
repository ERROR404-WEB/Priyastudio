import { assertLocalDemo } from '@/server/config';
import { jsonEndpoint, mutationOrigin, readJson } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { publicReviewCommand, requireShare, reviewView } from '@/server/shares';
import { getState, isDemo, mutate } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ token: string }> };
export async function GET(request: Request, context: Context) {
  return jsonEndpoint(async () => {
    assertLocalDemo(request);
    await rateLimit('public:review:read', 240);
    const { token } = await context.params;
    return { ...reviewView(await getState(), token), demo: isDemo() };
  });
}
export async function POST(request: Request, context: Context) {
  return jsonEndpoint(async () => {
    mutationOrigin(request);
    await rateLimit('public:review:write', 60);
    const { token } = await context.params;
    const body = await readJson(request, 24 * 1024);
    const share = requireShare(await getState(), token, 'review');
    await rateLimit(`share:${share.id}`, 5, 3600);
    await mutate((state, now) => publicReviewCommand(state, token, body, now), `share:${share.id}`);
    return { ok: true };
  });
}