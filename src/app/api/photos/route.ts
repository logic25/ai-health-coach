/* GET/POST /api/photos — progress photos (stored inline as data URLs; fine for
   a single-user MVP, swap for Supabase Storage later without schema changes) */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { query, queryOne } from "@/lib/db";

export const GET = route(async () => {
  const rows = await query(
    `select id, taken_at, pose, notes, context from progress_photos order by taken_at desc limit 50`
  );
  return json({ photos: rows });
});

const schema = z.object({
  imageBase64: z.string(),
  mediaType: z.string().default("image/jpeg"),
  pose: z.enum(["front", "side", "back"]).default("front"),
  notes: z.string().optional(),
});

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  // capture current weight/waist as context
  const ctx = await query(
    `select distinct on (kind) kind, value from measurements
     where kind in ('weight','waist') order by kind, taken_at desc`
  );
  const context: Record<string, number> = {};
  for (const c of ctx) context[c.kind] = Number(c.value);
  const row = await queryOne(
    `insert into progress_photos (pose, url, notes, context)
     values ($1,$2,$3,$4) returning id, taken_at, pose`,
    [b.pose, `data:${b.mediaType};base64,${b.imageBase64}`, b.notes ?? null, JSON.stringify(context)]
  );
  return json({ photo: row }, { status: 201 });
});
