import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { StudioProvider } from '@/components/studio/store';
import { StudioShell } from '@/components/studio/shell';
import '@/components/studio/studio.css';

export const metadata: Metadata = { title: 'Your studio', robots: { index: false, follow: false } };

export default function StudioLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="studio-gate" role="status">Opening your studio…</div>}><StudioProvider><StudioShell>{children}</StudioShell></StudioProvider></Suspense>;
}