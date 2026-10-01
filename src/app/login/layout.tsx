import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Welcome home · Hey Priya', robots: { index: false, follow: false } };
export default function LoginLayout({ children }: { children: ReactNode }) { return children; }