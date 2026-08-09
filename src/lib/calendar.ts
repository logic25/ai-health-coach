/* Google Calendar integration (REST, no SDK).
   Read availability + create workout events. The calendar is coaching input,
   not just display. Degrades gracefully when not configured: scheduling then
   assumes the preferred morning slot is free. */

import { query, queryOne, todayLocal, addDays } from "./db";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_BASE = "https://www.googleapis.com/calendar/v3";

export function calendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      (process.env.GOOGLE_REFRESH_TOKEN || cachedRefreshToken)
  );
}

let cachedRefreshToken: string | null = null;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/** OAuth callback stores the refresh token in the DB (single user). */
export async function storeRefreshToken(token: string): Promise<void> {
  cachedRefreshToken = token;
  await query(
    `update user_profile set preferences = preferences || jsonb_build_object('google_refresh_token', $1::text), updated_at = now()`,
    [token]
  );
}

async function getRefreshToken(): Promise<string | null> {
  if (process.env.GOOGLE_REFRESH_TOKEN) return process.env.GOOGLE_REFRESH_TOKEN;
  if (cachedRefreshToken) return cachedRefreshToken;
  const row = await queryOne(
    `select preferences->>'google_refresh_token' t from user_profile limit 1`
  );
  cachedRefreshToken = row?.t ?? null;
  return cachedRefreshToken;
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedAccessToken.token;
  }
  const refresh = await getRefreshToken();
  if (!refresh) throw new Error("Google Calendar not connected");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const data = await res.json();
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

export function authUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`code exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.refresh_token) await storeRefreshToken(data.refresh_token);
}

/** Sync the next N days of events into the local cache (coaching input). */
export async function syncEvents(days = 7): Promise<number> {
  const token = await getAccessToken();
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 86400_000).toISOString();
  const res = await fetch(
    `${CAL_BASE}/calendars/primary/events?singleEvents=true&orderBy=startTime` +
      `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=250`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`events fetch failed: ${res.status}`);
  const data = await res.json();
  let count = 0;
  for (const ev of data.items ?? []) {
    if (ev.status === "cancelled") continue;
    const allDay = !ev.start?.dateTime;
    const start = ev.start?.dateTime ?? (ev.start?.date ? ev.start.date + "T00:00:00Z" : null);
    const end = ev.end?.dateTime ?? (ev.end?.date ? ev.end.date + "T00:00:00Z" : null);
    if (!start || !end) continue;
    await query(
      `insert into calendar_events (external_id, calendar_id, title, start_at, end_at, all_day, busy, raw, synced_at)
       values ($1,'primary',$2,$3,$4,$5,$6,$7,now())
       on conflict (external_id) do update set
         title=excluded.title, start_at=excluded.start_at, end_at=excluded.end_at,
         all_day=excluded.all_day, busy=excluded.busy, raw=excluded.raw, synced_at=now()`,
      [ev.id, ev.summary ?? "(busy)", start, end, allDay,
       ev.transparency !== "transparent",
       JSON.stringify({ htmlLink: ev.htmlLink ?? null })]
    );
    count++;
  }
  return count;
}

/** Create a calendar event for a scheduled workout; returns the event id. */
export async function createWorkoutEvent(opts: {
  title: string;
  startIso: string;
  durationMin: number;
  focus?: string;
  workoutId: string;
  appBaseUrl?: string;
}): Promise<string> {
  const token = await getAccessToken();
  const end = new Date(new Date(opts.startIso).getTime() + opts.durationMin * 60_000);
  const res = await fetch(`${CAL_BASE}/calendars/primary/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: `🏋️ ${opts.title}`,
      description:
        `Focus: ${opts.focus ?? "training"}\nDuration: ${opts.durationMin} min\n` +
        `Open workout: ${opts.appBaseUrl ?? "http://localhost:3000"}/train/${opts.workoutId}`,
      start: { dateTime: opts.startIso },
      end: { dateTime: end.toISOString() },
    }),
  });
  if (!res.ok) throw new Error(`event create failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

// ---------------------------------------------------------------------------
// Availability windows (from the local cache — works even if Google is
// unreachable, using the last sync)
// ---------------------------------------------------------------------------

export interface Window {
  start: string; // ISO
  end: string;
  minutes: number;
}

/** Free windows on a date between dayStart and dayEnd local hours. */
export async function freeWindows(
  date: string,
  opts: { dayStartHour?: number; dayEndHour?: number; minMinutes?: number } = {}
): Promise<Window[]> {
  const tz = process.env.COACH_TZ || "America/New_York";
  const dayStartHour = opts.dayStartHour ?? 6;
  const dayEndHour = opts.dayEndHour ?? 21;
  const minMinutes = opts.minMinutes ?? 30;

  // Offset for the date in the user's timezone
  const probe = new Date(`${date}T12:00:00Z`);
  const offsetMin = tzOffsetMinutes(probe, tz);
  const mk = (h: number, m = 0) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + ((h * 60 + m) - offsetMin) * 60_000);

  const dayStart = mk(dayStartHour);
  const dayEnd = mk(dayEndHour);

  const events = await query(
    `select start_at, end_at from calendar_events
     where busy and not all_day and end_at > $1 and start_at < $2
     order by start_at`,
    [dayStart.toISOString(), dayEnd.toISOString()]
  );

  const windows: Window[] = [];
  let cursor = dayStart;
  for (const ev of events) {
    const s = new Date(ev.start_at);
    const e = new Date(ev.end_at);
    if (s > cursor) {
      const mins = (s.getTime() - cursor.getTime()) / 60_000;
      if (mins >= minMinutes)
        windows.push({ start: cursor.toISOString(), end: s.toISOString(), minutes: Math.floor(mins) });
    }
    if (e > cursor) cursor = e;
  }
  if (dayEnd > cursor) {
    const mins = (dayEnd.getTime() - cursor.getTime()) / 60_000;
    if (mins >= minMinutes)
      windows.push({ start: cursor.toISOString(), end: dayEnd.toISOString(), minutes: Math.floor(mins) });
  }
  return windows;
}

/** Minutes east of UTC for a timezone at a given instant. */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return (asUtc - at.getTime()) / 60_000;
}

/** Pick the best workout slot for a date: preferred morning time if free,
    otherwise the earliest adequate window. */
export async function proposeSlot(
  date: string,
  durationMin: number
): Promise<{ start: string; source: "preferred" | "adjusted" | "assumed" } | null> {
  const profile = await queryOne(`select preferences from user_profile limit 1`);
  const preferred: string = profile?.preferences?.preferred_workout_time ?? "07:30";
  const [ph, pm] = preferred.split(":").map(Number);

  const hasCalendar = (await queryOne(`select 1 x from calendar_events limit 1`)) != null;
  const tz = process.env.COACH_TZ || "America/New_York";
  const probe = new Date(`${date}T12:00:00Z`);
  const offsetMin = tzOffsetMinutes(probe, tz);
  const preferredStart = new Date(
    Date.parse(`${date}T00:00:00Z`) + ((ph * 60 + pm) - offsetMin) * 60_000
  );

  if (!hasCalendar) {
    return { start: preferredStart.toISOString(), source: "assumed" };
  }

  const windows = await freeWindows(date, { minMinutes: durationMin });
  for (const w of windows) {
    const ws = new Date(w.start).getTime();
    const we = new Date(w.end).getTime();
    if (
      preferredStart.getTime() >= ws &&
      preferredStart.getTime() + durationMin * 60_000 <= we
    ) {
      return { start: preferredStart.toISOString(), source: "preferred" };
    }
  }
  const first = windows.find((w) => w.minutes >= durationMin);
  return first ? { start: first.start, source: "adjusted" } : null;
}
