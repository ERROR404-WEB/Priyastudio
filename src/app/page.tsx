import { publicPortfolio } from '@/lib/domain';
import { createEmptyState } from '@/lib/seed';
import { getState, isDemo } from '@/server/store';
import { Portfolio } from '@/components/portfolio';

export const dynamic = 'force-dynamic';
export default async function HomePage() {
  let portfolio = publicPortfolio(createEmptyState());
  let demo = false;
  let unavailable = false;
  try { portfolio = publicPortfolio(await getState()); demo = isDemo(); }
  catch { unavailable = true; }
  return <Portfolio portfolio={portfolio} demo={demo} unavailable={unavailable} />;
}