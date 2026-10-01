import { requireAdmin } from '@/server/auth';
import { jsonEndpoint, mutationOrigin } from '@/server/http';
import { readUpload, saveImage } from '@/server/media';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public imagery only. The UI must explicitly disclose publication before invoking this route. */
export async function POST(request: Request) {
  return jsonEndpoint(async () => {
    mutationOrigin(request);
    await requireAdmin(request);
    await rateLimit('studio:upload', 20, 3600);
    return { url: await saveImage(await readUpload(request)) };
  });
}