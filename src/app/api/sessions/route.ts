/* POST /api/sessions — start a workout session { workout_id? } */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { queryOne, query } from "@/lib/db";

const schema = z.object({ workout_id: z.string().optional() });

export const POST = route(async (req) => {
  const b = schema.parse(await req.json().catch(() => ({})));
  const session = await queryOne(
    `insert into workout_sessions (workout_id, source) values ($1,'manual') returning *`,
    [b.workout_id ?? null]
  );
  if (b.workout_id) {
    await query(`update workouts set status='in_progress', updated_at=now() where id=$1`, [b.workout_id]);
  }
  return json({ session }, { status: 201 });
});
