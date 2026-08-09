import { Pool, types } from "pg";

// Return numerics as numbers, not strings (safe for our value ranges).
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));
// Return DATE columns as plain 'YYYY-MM-DD' strings to avoid TZ drift.
types.setTypeParser(1082, (v) => v);

declare global {
   
  var __coachPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!global.__coachPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    global.__coachPool = new Pool({
      connectionString,
      max: 5,
      ssl: connectionString.includes("supabase.co")
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return global.__coachPool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = any>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function queryOne<T = any>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Local date string (YYYY-MM-DD) in the user's timezone. */
export function todayLocal(tz = process.env.COACH_TZ || "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/** Monday of the week containing the given date string. */
export function weekStartOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun
  const diff = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
