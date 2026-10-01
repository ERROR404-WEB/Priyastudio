import type { Metadata } from 'next';
import { PublicProposal } from '@/components/public-share';
export const metadata: Metadata = { title: 'Your collaboration proposal', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicProposal token={token} />;
}