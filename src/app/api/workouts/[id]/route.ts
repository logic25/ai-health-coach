/* GET/PATCH /api/workouts/:id — status transitions (complete/skip/reschedule) */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { query, queryOne } from "@/lib/db";

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const rows = await query(
    `select w.*, coalesce(json_agg(json_build_object(
        'id', p.id, 'seq', p.seq, 'sets', p.sets, 'reps', p.reps,
        'time_seconds', p.time_seconds, 'load_lb', p.load_lb,
        'rest_seconds', p.rest_seconds, 'target_rpe', p.target_rpe,
        'reasoning', p.reasoning,
        'exercise', json_build_object('id', e.id, 'slug', e.slug, 'name', e.name,
          'movement_pattern', e.movement_pattern, 'form_cues', e.form_cues,
          'common_errors', e.common_errors, 'instructions', e.instructions,
          'demo_url', e.demo_url, 'equipment', e.equipment)
      ) order by p.seq) filter (where p.id is not null), '[]') as prescriptions
     from workouts w
     left join exercise_prescriptions p on p.workout_id = w.id
     left join exercises e on e.id = p.exercise_id
     where w.id = $1 group by w.id`,
    [id]
  );
  if (!rows[0]) return json({ error: "not found" }, { status: 404 });

  // previous performance per exercise (for "previous" display in workout mode)
  const prev = await query(
    `select distinct on (p.exercise_id) p.exercise_id, p.reps, p.load_lb, p.time_seconds, p.rpe, p.recorded_at
     from exercise_performances p
     where p.exercise_id in (select exercise_id from exercise_prescriptions where workout_id=$1)
     order by p.exercise_id, p.recorded_at desc`,
    [id]
  );
  return json({ workout: rows[0], previous_performances: prev });
});

const patchSchema = z.object({
  status: z.enum(["planned", "scheduled", "in_progress", "completed", "skipped", "rescheduled"]).optional(),
  status_reason: z.string().optional(),
  scheduled_date: z.string().optional(),
  scheduled_start: z.string().optional(),
});

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = patchSchema.parse(await req.json());
  const row = await queryOne(
    `update workouts set
       status = coalesce($2, status),
       status_reason = coalesce($3, status_reason),
       scheduled_date = coalesce($4::date, scheduled_date),
       scheduled_start = coalesce($5::timestamptz, scheduled_start),
       updated_at = now()
     where id = $1 returning *`,
    [id, b.status ?? null, b.status_reason ?? null, b.scheduled_date ?? null, b.scheduled_start ?? null]
  );
  if (!row) return json({ error: "not found" }, { status: 404 });
  return json({ workout: row });
});
