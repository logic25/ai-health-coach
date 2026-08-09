/* Morning coach routine — the daily closed-loop entry point.
   Deterministic steps (data checks, recovery, scheduling, targets) with an
   LLM-written brief on top. Runs idempotently; safe to call repeatedly. */

import { query, queryOne, todayLocal } from "./db";
import { refreshTodayRecovery } from "./recovery";
import { generateWorkout } from "./programming";
import { proposeSlot, calendarConfigured, syncEvents } from "./calendar";
import { buildSnapshot, renderSnapshot } from "./snapshot";
import { getLlm, llmAvailable } from "./llm";

export interface MorningResult {
  date: string;
  weighInMissing: boolean;
  recovery: { score: number; band: string };
  workout: Record<string, unknown> | null;
  proposedSlot: { start: string; source: string } | null;
  target: Record<string, unknown> | null;
  focus: string;
  brief: string;
  notifications: string[];
}

export async function runMorningCoach(): Promise<MorningResult> {
  const date = todayLocal();
  const tz = process.env.COACH_TZ || "America/New_York";
  const notifications: string[] = [];

  // 1-2) latest health data + weigh-in check
  const weight = await queryOne(
    `select 1 x from measurements where kind='weight' and taken_at::date = current_date`
  );
  const weighInMissing = !weight;
  if (weighInMissing) {
    await ensureNotification("weigh_in_missing", "Morning weigh-in missing",
      "Step on the scale before training — it keeps the trend clean.");
    notifications.push("weigh_in_missing");
  }

  // Calendar sync (best effort)
  if (calendarConfigured()) {
    try { await syncEvents(7); } catch { /* stale cache is fine */ }
  }

  // 4-10) recovery assessment
  const recovery = await refreshTodayRecovery(date);

  // 11) today's training: reuse existing workout or generate one
  let workout = await queryOne(
    `select * from workouts where scheduled_date=$1 order by created_at desc limit 1`,
    [date]
  );
  if (!workout) {
    try {
      const gen = await generateWorkout({ date });
      workout = await queryOne(`select * from workouts where id=$1`, [gen.workoutId]);
    } catch (e) {
      console.error("workout generation failed", e);
    }
  }

  // 12) scheduling proposal (preferred morning slot when practical)
  let proposedSlot: { start: string; source: string } | null = null;
  if (workout && !workout.scheduled_start && workout.status !== "completed") {
    proposedSlot = await proposeSlot(date, workout.duration_min ?? 40);
    if (proposedSlot && proposedSlot.source === "adjusted") {
      const t = new Date(proposedSlot.start).toLocaleTimeString("en-US",
        { timeZone: tz, hour: "numeric", minute: "2-digit" });
      await ensureNotification("reschedule_needed", "Morning slot is blocked",
        `Your usual morning workout conflicts with the calendar. ${t} is open — schedule it?`);
      notifications.push("reschedule_needed");
    }
  }

  // 13) nutrition target for today (defaults to standing target)
  let target = await queryOne(`select * from nutrition_targets where date=$1`, [date]);
  if (!target) {
    target = await queryOne(`select * from nutrition_targets where date is null limit 1`);
  }

  // 14) one primary coaching focus + morning brief
  let focus = deterministicFocus(recovery.band, weighInMissing);
  let brief =
    `Recovery ${recovery.score}/${recovery.band.toUpperCase()}. ` +
    (workout ? `Today: ${workout.title} (${workout.duration_min} min). ` : "") +
    focus;

  if (llmAvailable()) {
    try {
      const snapshot = await buildSnapshot();
      const llm = getLlm();
      const res = await llm.complete({
        system:
          `You are the user's morning health coach. Write a SHORT morning brief (3-5 sentences max): ` +
          `recovery read, today's training call, nutrition targets, and exactly ONE primary focus for the day. ` +
          `Preferred rhythm: bathroom → weigh → train → first meal ~12-1pm. Plain text.\n\n=== SNAPSHOT ===\n` +
          renderSnapshot(snapshot),
        messages: [{ role: "user", content: `Morning brief for ${date}. Weigh-in missing: ${weighInMissing}.` }],
        maxTokens: 400,
      });
      if (res.text.trim()) {
        brief = res.text.trim();
        const m = brief.match(/focus[^:]*:\s*([^\n.]+)/i);
        if (m) focus = m[1].trim();
      }
    } catch { /* deterministic brief stands */ }
  }

  await query(
    `insert into coach_decisions (kind, decision, reasoning, context, status)
     values ('daily_focus', $1, $2, $3, 'proposed')`,
    [focus, brief, JSON.stringify({ date, recovery, weigh_in_missing: weighInMissing }), ]
  );

  return {
    date,
    weighInMissing,
    recovery: { score: recovery.score, band: recovery.band },
    workout,
    proposedSlot,
    target,
    focus,
    brief,
    notifications,
  };
}

function deterministicFocus(band: string, weighInMissing: boolean): string {
  if (weighInMissing) return "Weigh in first, then train before the day gets busy.";
  if (band === "red") return "Recovery day: mobility, a walk, and an early night beat forcing a session.";
  if (band === "yellow") return "Train, but keep effort at RPE ≤7 and get to bed early tonight.";
  return "Complete the workout before your first meal; front-load protein when eating opens.";
}

async function ensureNotification(kind: string, title: string, body: string): Promise<void> {
  // restraint: at most one unseen notification of a kind per day
  const existing = await queryOne(
    `select 1 x from notifications where kind=$1 and created_at::date=current_date and dismissed_at is null`,
    [kind]
  );
  if (!existing) {
    await query(
      `insert into notifications (kind, title, body) values ($1,$2,$3)`,
      [kind, title, body]
    );
  }
}
