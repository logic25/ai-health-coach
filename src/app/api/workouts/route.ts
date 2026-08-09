/* GET /api/workouts?date=YYYY-MM-DD | ?upcoming=1 — workouts with prescriptions */
import { route, json } from "@/lib/api";
import { query, todayLocal } from "@/lib/db";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const upcoming = url.searchParams.get("upcoming");

  const where = upcoming
    ? `w.scheduled_date >= $1::date`
    : `w.scheduled_date = $1::date`;
  const workouts = await query(
    `select w.*, coalesce(json_agg(json_build_object(
        'id', p.id, 'seq', p.seq, 'sets', p.sets, 'reps', p.reps,
        'time_seconds', p.time_seconds, 'load_lb', p.load_lb,
        'rest_seconds', p.rest_seconds, 'target_rpe', p.target_rpe,
        'reasoning', p.reasoning,
        'exercise', json_build_object('id', e.id, 'slug', e.slug, 'name', e.name,
          'movement_pattern', e.movement_pattern, 'form_cues', e.form_cues,
          'instructions', e.instructions, 'demo_url', e.demo_url,
          'equipment', e.equipment)
      ) order by p.seq) filter (where p.id is not null), '[]') as prescriptions
     from workouts w
     left join exercise_prescriptions p on p.workout_id = w.id
     left join exercises e on e.id = p.exercise_id
     where ${where}
     group by w.id
     order by w.scheduled_date, w.created_at desc limit 20`,
    [date ?? todayLocal()]
  );
  return json({ workouts });
});
