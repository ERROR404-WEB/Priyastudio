import { assertLocalDemo } from '@/server/config';
import { jsonEndpoint } from '@/server/http';
import { loadImage } from '@/server/media';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return jsonEndpoint(async () => {
    assertLocalDemo(request);
    await rateLimit('public:media', 600);
    const { id } = await context.params;
    const { data, contentType } = await loadImage(id);
    return new Response(data, { headers: {
      'Content-Type': contentType, 'Content-Length': String(data.byteLength),
      'Content-Disposition': `inline; filename="${id}"`, 'Content-Security-Policy': "default-src 'none'; sandbox",
    } });
  });
}