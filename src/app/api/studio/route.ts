import { z } from 'zod';
import { commandSchema } from '@/lib/domain';
import { requireAdmin } from '@/server/auth';
import { HttpError } from '@/server/errors';
import { jsonEndpoint, mutationOrigin, readJson } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { getState, isDemo, mutate } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const bodySchema = z.object({ command: z.object({ type: z.string() }).passthrough() }).strict();
const publicOnly = new Set(['share.create', 'testimonial.create', 'proposal.accept', 'proposal.comment']);

export async function GET(request: Request) {
  return jsonEndpoint(async () => {
    await requireAdmin(request);
    await rateLimit('studio:read', 240);
    return { state: await getState(), demo: isDemo() };
  });
}
export async function POST(request: Request) {
  return jsonEndpoint(async () => {
    mutationOrigin(request);
    const actor = await requireAdmin(request);
    await rateLimit('studio:write', 120);
    const body = bodySchema.parse(await readJson(request));
    if (publicOnly.has(body.command.type)) throw new HttpError(403, 'Use the scoped share endpoint for this action');
    const command = commandSchema.parse(body.command);
    return { state: await mutate(command, actor) };
  });
}