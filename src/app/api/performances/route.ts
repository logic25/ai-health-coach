/* POST /api/performances — log a set with minimal taps.
   { session_id?, prescription_id?, exercise_id, set_number, reps?, load_lb?, time_seconds?, rpe?, notes? } */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { queryOne } from "@/lib/db";

const schema = z.object({
  session_id: z.string().optional(),
  prescription_id: z.string().optional(),
  exercise_id: z.string(),
  set_number: z.number().int().default(1),
  reps: z.number().int().optional(),
  load_lb: z.number().optional(),
  time_seconds: z.number().int().optional(),
  rpe: z.number().optional(),
  completed: z.boolean().default(true),
  notes: z.string().optional(),
});

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  const row = await queryOne(
    `insert into exercise_performances (session_id, prescription_id, exercise_id, set_number,
       reps, load_lb, time_seconds, rpe, completed, notes, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual') returning *`,
    [b.session_id ?? null, b.prescription_id ?? null, b.exercise_id, b.set_number,
     b.reps ?? null, b.load_lb ?? null, b.time_seconds ?? null, b.rpe ?? null,
     b.completed, b.notes ?? null]
  );
  return json({ performance: row }, { status: 201 });
});
