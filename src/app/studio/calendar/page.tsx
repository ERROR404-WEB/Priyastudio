import { CalendarPage } from '@/components/studio/calendar';

export default async function Page({ searchParams }: { searchParams: Promise<{ connection?: string }> }) {
  const { connection } = await searchParams;
  return <CalendarPage connectionResult={connection === 'connected' || connection === 'failed' ? connection : undefined} />;
}