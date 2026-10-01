import { publicPortfolio } from '@/lib/domain';
import { assertLocalDemo } from '@/server/config';
import { jsonEndpoint } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { getState, isDemo } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return jsonEndpoint(async () => {
    assertLocalDemo(request);
    await rateLimit('public:portfolio', 240);
    return { portfolio: publicPortfolio(await getState()), demo: isDemo() };
  });
}