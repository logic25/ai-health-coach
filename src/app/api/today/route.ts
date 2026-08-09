/* GET /api/today — everything the Today dashboard needs in one call */
import { route, json } from "@/lib/api";
import { query, queryOne, todayLocal } from "@/lib/db";
import { todaysMacros } from "@/lib/nutrition/estimate";

export const GET = route(async () => {
  const date = todayLocal();
  const tz = process.env.COACH_TZ || "America/New_York";

  const [latest, dailyState, workout, macros, sleepRow, hrvRow, rhrRow, decisions, notifications, events] =
    await Promise.all([
      query(`select distinct on (kind) kind, value, unit, taken_at, location from measurements order by kind, taken_at desc`),
      queryOne(`select * from daily_states where date=$1`, [date]),
      queryOne(
        `select w.*, (select count(*) from exercise_prescriptions p where p.workout_id=w.id) as exercise_count
         from workouts w where w.scheduled_date=$1 order by w.created_at desc limit 1`,
        [date]
      ),
      todaysMacros(),
      queryOne(`select value from recovery_metrics where kind='sleep_duration_min' and date=$1`, [date]),
      queryOne(`select value from recovery_metrics where kind='hrv_ms' and date=$1`, [date]),
      queryOne(`select value from recovery_metrics where kind='resting_hr_bpm' and date=$1`, [date]),
      query(
        `select kind, decision, reasoning, made_at from coach_decisions
         where kind in ('daily_focus','daily_training') and made_at::date=current_date
         order by made_at desc limit 2`
      ),
      query(`select * from notifications where dismissed_at is null and due_at <= now() order by due_at desc limit 5`),
      query(
        `select title, start_at, end_at from calendar_events
         where start_at >= now() and (start_at at time zone $1)::date = $2::date
         order by start_at limit 8`,
        [tz, date]
      ),
    ]);

  const measurements: Record<string, unknown> = {};
  for (const m of latest) measurements[m.kind] = m;

  const focus = decisions.find((d) => d.kind === "daily_focus");

  return json({
    date,
    measurements,
    daily_state: dailyState,
    recovery: dailyState
      ? { score: dailyState.recovery_score, band: dailyState.recovery_band }
      : null,
    sleep_min: sleepRow?.value ?? null,
    hrv: hrvRow?.value ?? null,
    rhr: rhrRow?.value ?? null,
    workout,
    nutrition: macros,
    focus: focus?.decision ?? null,
    brief: focus?.reasoning ?? null,
    notifications,
    upcoming_events: events,
  });
});
