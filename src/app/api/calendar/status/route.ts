/* GET /api/calendar/status — connection + freshness; POST — force sync */
import { route, json } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { calendarConfigured, syncEvents } from "@/lib/calendar";

export const GET = route(async () => {
  const last = await queryOne(`select max(synced_at) t, count(*) n from calendar_events`);
  const tokenStored = await queryOne(
    `select (preferences ? 'google_refresh_token') has from user_profile limit 1`
  );
  return json({
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    connected: calendarConfigured() || Boolean(tokenStored?.has),
    last_sync: last?.t ?? null,
    cached_events: Number(last?.n ?? 0),
  });
});

export const POST = route(async () => {
  const count = await syncEvents(7);
  return json({ synced: count });
});
