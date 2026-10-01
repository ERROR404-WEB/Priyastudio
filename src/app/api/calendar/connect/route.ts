import { jsonEndpoint } from '@/server/http';
import { calendarHandlers } from '@/server/calendar/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return jsonEndpoint(() => calendarHandlers().connect(request)); }