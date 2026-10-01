import { z } from 'zod';
import { requireAdmin } from '@/server/auth';
import { jsonEndpoint, mutationOrigin, readJson } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { createShareCommand, newToken } from '@/server/shares';
import { mutate } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const input = z.object({ targetId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/), scope: z.enum(['proposal', 'review']) }).strict();

export async function POST(request: Request) {
  return jsonEndpoint(async () => {
    const origin = mutationOrigin(request);
    const actor = await requireAdmin(request);
    await rateLimit('studio:share', 30);
    const { targetId, scope } = input.parse(await readJson(request, 2048));
    const token = newToken();
    const state = await mutate((current, now) => createShareCommand(current, targetId, scope, token, now), actor);
    return { state, shareUrl: new URL(`/${scope === 'proposal' ? 'p' : 'review'}/${token}`, origin).href };
  });
}