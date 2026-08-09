/* GET  /api/measurements?kind=weight&days=28
   POST /api/measurements — fast manual entry
   { kind, value, unit, location?, state?, timing?, notes?, taken_at? } */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { query, queryOne } from "@/lib/db";

const postSchema = z.object({
  kind: z.string(),
  value: z.number(),
  unit: z.string(),
  location: z.string().optional(),
  method: z.string().optional(),
  state: z.string().optional(),
  timing: z.string().optional(),
  notes: z.string().optional(),
  taken_at: z.string().optional(),
});

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const days = Number(url.searchParams.get("days") ?? 60);
  const rows = await query(
    `select * from measurements
     where ($1::text is null or kind = $1) and taken_at > now() - ($2 || ' days')::interval
     order by taken_at desc limit 500`,
    [kind, days]
  );
  return json({ measurements: rows });
});

export const POST = route(async (req) => {
  const body = postSchema.parse(await req.json());
  // sensible defaults for waist per the user's protocol
  const location = body.location ?? (body.kind === "waist" ? "navel" : null);
  const state = body.state ?? (body.kind === "waist" ? "relaxed" : null);
  const row = await queryOne(
    `insert into measurements (kind, value, unit, location, method, state, timing, notes, taken_at, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::timestamptz, now()),'manual')
     returning *`,
    [body.kind, body.value, body.unit, location, body.method ?? null, state,
     body.timing ?? null, body.notes ?? null, body.taken_at ?? null]
  );
  return json({ measurement: row }, { status: 201 });
});
