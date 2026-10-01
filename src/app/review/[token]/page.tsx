import type { Metadata } from 'next';
import { PublicReview } from '@/components/public-share';
export const metadata: Metadata = { title: 'A little feedback', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicReview token={token} />;
}