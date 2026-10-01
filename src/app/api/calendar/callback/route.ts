import { privateHeaders } from '@/server/http';
import { calendarHandlers } from '@/server/calendar/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
	try { return await calendarHandlers().callback(request); }
	catch {
		return new Response(null, { status: 303, headers: { ...privateHeaders, Location: '/studio/calendar?connection=failed' } });
	}
}