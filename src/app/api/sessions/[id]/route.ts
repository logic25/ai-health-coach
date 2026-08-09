/* PATCH /api/sessions/:id — end session { session_rpe?, energy?, notes?, completed? } */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { queryOne, query } from "@/lib/db";

const schema = z.object({
  session_rpe: z.number().optional(),
  energy: z.number().int().optional(),
  notes: z.string().optional(),
  completed: z.boolean().default(true),
});

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = schema.parse(await req.json());
  const session = await queryOne(
    `update workout_sessions set ended_at=now(),
       session_rpe=coalesce($2, session_rpe), energy=coalesce($3, energy),
       notes=coalesce($4, notes)
     where id=$1 returning *`,
    [id, b.session_rpe ?? null, b.energy ?? null, b.notes ?? null]
  );
  if (!session) return json({ error: "not found" }, { status: 404 });
  if (session.workout_id) {
    await query(
      `update workouts set status=$2, updated_at=now() where id=$1`,
      [session.workout_id, b.completed ? "completed" : "skipped"]
    );
  }
  return json({ session });
});
