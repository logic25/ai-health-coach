/* POST /api/workouts/:id/schedule — place workout into a calendar window.
   { startIso? } — omitted: coach proposes the best slot (preferred morning if free).
   Adds a Google Calendar event when connected. */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { queryOne, query } from "@/lib/db";
import { proposeSlot, createWorkoutEvent, calendarConfigured } from "@/lib/calendar";

const schema = z.object({ startIso: z.string().optional() });

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = schema.parse(await req.json().catch(() => ({})));
  const workout = await queryOne(`select * from workouts where id=$1`, [id]);
  if (!workout) return json({ error: "not found" }, { status: 404 });

  let start = b.startIso ?? null;
  let source = "manual";
  if (!start) {
    const slot = await proposeSlot(workout.scheduled_date, workout.duration_min ?? 40);
    if (!slot) return json({ error: "no adequate free window found today" }, { status: 409 });
    start = slot.start;
    source = slot.source;
  }

  let calendarEventId: string | null = null;
  if (calendarConfigured()) {
    try {
      calendarEventId = await createWorkoutEvent({
        title: workout.title,
        startIso: start,
        durationMin: workout.duration_min ?? 40,
        focus: workout.focus,
        workoutId: id,
        appBaseUrl: process.env.APP_BASE_URL,
      });
    } catch (e) {
      console.error("calendar event creation failed", e);
    }
  }

  const updated = await queryOne(
    `update workouts set status='scheduled', scheduled_start=$2::timestamptz,
       calendar_event_id=coalesce($3, calendar_event_id), updated_at=now()
     where id=$1 returning *`,
    [id, start, calendarEventId]
  );
  await query(
    `insert into coach_decisions (kind, decision, reasoning, context, status)
     values ('reschedule', $1, $2, $3, 'accepted')`,
    [`Scheduled ${workout.title} at ${start}`,
     source === "preferred" ? "Preferred morning slot is free." :
     source === "adjusted" ? "Preferred slot blocked by calendar; placed in earliest adequate window." :
     source === "assumed" ? "No calendar connected; assumed preferred morning slot." : "Manual selection.",
     JSON.stringify({ workout_id: id, start, slot_source: source })]
  );
  return json({ workout: updated, calendar_event_id: calendarEventId, slot_source: source });
});
