/* POST /api/calendar/schedule-week — weekly scheduling pass:
   inspect calendar + plan template + recovery, propose workout slots for the
   remaining days of this week. Stored as a CalendarPlan (status=proposed);
   confirm per-workout via /api/workouts/:id/schedule. */
import { route, json } from "@/lib/api";
import { query, queryOne, todayLocal, weekStartOf, addDays } from "@/lib/db";
import { proposeSlot, calendarConfigured, syncEvents } from "@/lib/calendar";
import { generateWorkout } from "@/lib/programming";

export const POST = route(async () => {
  const today = todayLocal();
  const weekStart = weekStartOf(today);
  if (calendarConfigured()) {
    try { await syncEvents(8); } catch { /* stale cache ok */ }
  }

  const plan = await queryOne(
    `select * from training_plans where status='active' order by created_at desc limit 1`
  );
  const template: { day: string; focus: string; type: string; optional?: boolean }[] =
    plan?.template?.week ?? [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const schedule: Record<string, unknown>[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    if (date < today) continue;
    const dow = dayNames[new Date(date + "T00:00:00Z").getUTCDay()];
    const tday = template.find((t) => t.day === dow);
    if (!tday || tday.type === "recovery" || tday.optional) continue;

    // reuse existing workout for that date or generate one
    let workout = await queryOne(
      `select * from workouts where scheduled_date=$1 and status in ('planned','scheduled')
       order by created_at desc limit 1`,
      [date]
    );
    if (!workout) {
      try {
        const gen = await generateWorkout({ date, focusHint: tday.focus });
        workout = await queryOne(`select * from workouts where id=$1`, [gen.workoutId]);
      } catch (e) {
        schedule.push({ date, focus: tday.focus, error: String(e) });
        continue;
      }
    }
    const slot = await proposeSlot(date, workout.duration_min ?? 40);
    schedule.push({
      workout_id: workout.id,
      date,
      title: workout.title,
      focus: workout.focus,
      duration_min: workout.duration_min,
      proposed_start: slot?.start ?? null,
      slot_source: slot?.source ?? "none",
    });
  }

  const reasoning =
    "Weekly pass: placed each planned session at the preferred morning time when free, otherwise the earliest adequate calendar window. Confirm each to add to Google Calendar.";
  const row = await queryOne(
    `insert into calendar_plans (week_start, schedule, status, reasoning)
     values ($1,$2,'proposed',$3) returning *`,
    [weekStart, JSON.stringify(schedule), reasoning]
  );
  return json({ plan: row, schedule });
});
