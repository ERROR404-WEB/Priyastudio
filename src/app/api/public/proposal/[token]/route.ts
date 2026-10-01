import { assertLocalDemo } from '@/server/config';
import { jsonEndpoint, mutationOrigin, readJson } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { proposalView, publicProposalCommand, requireShare } from '@/server/shares';
import { getState, isDemo, mutate } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ token: string }> };
export async function GET(request: Request, context: Context) {
  return jsonEndpoint(async () => {
    assertLocalDemo(request);
    await rateLimit('public:proposal:read', 240);
    const { token } = await context.params;
    return { ...proposalView(await getState(), token), demo: isDemo() };
  });
}
export async function POST(request: Request, context: Context) {
  return jsonEndpoint(async () => {
    mutationOrigin(request);
    await rateLimit('public:proposal:write', 120);
    const { token } = await context.params;
    const body = await readJson(request, 24 * 1024);
    const share = requireShare(await getState(), token, 'proposal');
    await rateLimit(`share:${share.id}`, 15, 600);
    // This lookup is deliberately repeated inside mutate on EVERY CAS attempt.
    await mutate((state, now) => publicProposalCommand(state, token, body, now), `share:${share.id}`);
    return { ok: true };
  });
}