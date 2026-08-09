/* PATCH /api/meals/:id — confirm a planned meal as eaten, or delete */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { query, queryOne } from "@/lib/db";

const schema = z.object({
  status: z.enum(["estimated", "confirmed", "corrected"]).optional(),
  eaten_at: z.string().optional(),
});

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = schema.parse(await req.json());
  const row = await queryOne(
    `update meals set status = coalesce($2, status),
       eaten_at = coalesce($3::timestamptz, eaten_at), updated_at = now()
     where id=$1 returning *`,
    [id, b.status ?? null, b.eaten_at ?? null]
  );
  if (!row) return json({ error: "not found" }, { status: 404 });
  return json({ meal: row });
});

export const DELETE = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await query(`delete from meals where id=$1`, [id]);
  return json({ ok: true });
});
