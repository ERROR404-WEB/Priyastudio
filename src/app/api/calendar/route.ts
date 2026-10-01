import { jsonEndpoint } from '@/server/http';
import { calendarHandlers } from '@/server/calendar/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
export async function GET(request: Request) { return jsonEndpoint(() => calendarHandlers().GET(request)); }
export async function POST(request: Request) { return jsonEndpoint(() => calendarHandlers().POST(request)); }