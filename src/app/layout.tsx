import type { Metadata } from 'next';
import { ThemeProvider, ThemeScript } from '@/components/theme-provider';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import './globals.css';
import '@/components/portfolio.css';

export const metadata: Metadata = {
  title: { default: 'Hey Priya · Stories with a little soul', template: '%s · Hey Priya Studio' },
  description: 'Lifestyle, food, cafés and little escapes. Discover Priya’s creative portfolio and create something lovely together.',
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><ThemeScript /></head><body><ThemeProvider>{children}</ThemeProvider></body></html>;
}