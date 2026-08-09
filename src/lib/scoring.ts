/* Weekly closed loop: expected vs actual, execution score, outcome score,
   coach decision logic. All deterministic and testable. */

import { query, queryOne, weekStartOf, addDays, todayLocal } from "./db";

const TZ = () => process.env.COACH_TZ || "America/New_York";

// ---------------------------------------------------------------------------
// Expected outcomes: defined BEFORE the week happens
// ---------------------------------------------------------------------------

export const DEFAULT_EXPECTATIONS: Record<string, { min?: number; max?: number; target?: number; unit: string }> = {
  weight_change_lb: { min: -1.2, max: -0.7, unit: "lb" },
  waist_change_in: { min: -0.25, max: 0, unit: "in" },
  strength_sessions: { target: 4, unit: "sessions" },
  boxing_sessions: { target: 1, unit: "sessions" },
  aerobic_min: { target: 90, unit: "min" },
  steps_avg: { target: 6000, unit: "steps/day" },
  protein_days: { target: 6, unit: "days >=180g" },
  sleep_avg_h: { target: 7, unit: "h" },
};

export async function ensureExpectedOutcomes(weekStart: string): Promise<void> {
  for (const [metric, expected] of Object.entries(DEFAULT_EXPECTATIONS)) {
    await query(
      `insert into expected_outcomes (week_start, metric, expected)
       values ($1,$2,$3) on conflict (week_start, metric) do nothing`,
      [weekStart, metric, JSON.stringify(expected)]
    );
  }
}

// ---------------------------------------------------------------------------
// Actuals: computed deterministically from canonical state
// ---------------------------------------------------------------------------

export interface WeekAggregates {
  weekStart: string;
  weekEnd: string;
  avgWeight: number | null;
  prevAvgWeight: number | null;
  weightChange: number | null;
  latestWaist: number | null;
  prevWaist: number | null;
  waistChange: number | null;
  plannedWorkouts: number;
  completedWorkouts: number;
  strengthSessions: number;
  boxingSessions: number;
  aerobicMin: number;
  avgSessionRpe: number | null;
  avgSleepH: number | null;
  avgHrv: number | null;
  avgRhr: number | null;
  avgSoreness: number | null;
  avgKcal: number | null;
  avgProtein: number | null;
  proteinDays: number;
  kcalAdherenceDays: number;
  loggedDays: number;
  stepsAvg: number | null;
  measurementDays: number;
}

export async function computeWeekAggregates(weekStart: string): Promise<WeekAggregates> {
  const weekEnd = addDays(weekStart, 7); // exclusive
  const prevStart = addDays(weekStart, -7);
  const tz = TZ();

  const [
    weightRow, prevWeightRow, waistRow, prevWaistRow,
    workoutRow, sessionsRow, sleepRow, hrvRhrRow, sorenessRow,
    nutritionRow, proteinDaysRow, stepsRow, measurementDaysRow, targetRow,
  ] = await Promise.all([
    queryOne(
      `select avg(value) v from measurements where kind='weight'
       and taken_at >= $1::date and taken_at < $2::date`, [weekStart, weekEnd]),
    queryOne(
      `select avg(value) v from measurements where kind='weight'
       and taken_at >= $1::date and taken_at < $2::date`, [prevStart, weekStart]),
    queryOne(
      `select value from measurements where kind='waist'
       and taken_at < $1::date order by taken_at desc limit 1`, [weekEnd]),
    queryOne(
      `select value from measurements where kind='waist'
       and taken_at < $1::date order by taken_at desc limit 1`, [weekStart]),
    queryOne(
      `select count(*) filter (where status in ('planned','scheduled','completed','skipped','rescheduled')) planned,
              count(*) filter (where status = 'completed') completed
       from workouts where scheduled_date >= $1::date and scheduled_date < $2::date`,
      [weekStart, weekEnd]),
    query(
      `select s.*, coalesce(s.raw->>'activity_type','') activity_type,
              coalesce((s.raw->>'duration_min')::numeric,
                extract(epoch from (s.ended_at - s.started_at))/60) dur_min
       from workout_sessions s
       where s.started_at >= $1::date and s.started_at < $2::date`,
      [weekStart, weekEnd]),
    queryOne(
      `select avg(value) v from recovery_metrics where kind='sleep_duration_min'
       and date >= $1::date and date < $2::date`, [weekStart, weekEnd]),
    queryOne(
      `select avg(value) filter (where kind='hrv_ms') hrv,
              avg(value) filter (where kind='resting_hr_bpm') rhr
       from recovery_metrics where date >= $1::date and date < $2::date`,
      [weekStart, weekEnd]),
    queryOne(
      `select avg(soreness) v from daily_states
       where date >= $1::date and date < $2::date`, [weekStart, weekEnd]),
    queryOne(
      `select avg(day_kcal) kcal, avg(day_protein) protein, count(*) days from (
         select (eaten_at at time zone $3)::date d, sum(kcal) day_kcal, sum(protein_g) day_protein
         from meals where status <> 'planned'
           and (eaten_at at time zone $3)::date >= $1::date
           and (eaten_at at time zone $3)::date < $2::date
         group by 1) t`,
      [weekStart, weekEnd, tz]),
    queryOne(
      `select count(*) v from (
         select (eaten_at at time zone $3)::date d, sum(protein_g) p
         from meals where status <> 'planned'
           and (eaten_at at time zone $3)::date >= $1::date
           and (eaten_at at time zone $3)::date < $2::date
         group by 1 having sum(protein_g) >= 180) t`,
      [weekStart, weekEnd, tz]),
    queryOne(
      `select avg(value) v from activity_metrics where kind='steps'
       and date >= $1::date and date < $2::date`, [weekStart, weekEnd]),
    queryOne(
      `select count(distinct taken_at::date) v from measurements
       where kind in ('weight','waist')
       and taken_at >= $1::date and taken_at < $2::date`, [weekStart, weekEnd]),
    queryOne(
      `select kcal from nutrition_targets where date is null limit 1`),
  ]);

  // Strength/boxing/aerobic from sessions
  let strength = 0, boxing = 0, aerobicMin = 0;
  const rpes: number[] = [];
  for (const s of sessionsRow) {
    const type = (s.activity_type || "").toLowerCase();
    if (type.includes("boxing")) { boxing++; aerobicMin += Number(s.dur_min) || 0; }
    else if (type.includes("walk") || type.includes("run") || type.includes("cycl") || type.includes("cardio")) {
      aerobicMin += Number(s.dur_min) || 0;
    } else strength++;
    if (s.session_rpe != null) rpes.push(Number(s.session_rpe));
  }

  const targetKcal = targetRow?.kcal ?? 2000;
  const kcalAdherenceDays = await queryOne(
    `select count(*) v from (
       select (eaten_at at time zone $4)::date d, sum(kcal) k
       from meals where status <> 'planned'
         and (eaten_at at time zone $4)::date >= $1::date
         and (eaten_at at time zone $4)::date < $2::date
       group by 1 having abs(sum(kcal) - $3) <= $3 * 0.12) t`,
    [weekStart, weekEnd, targetKcal, tz]
  );

  const avgWeight = weightRow?.v != null ? +Number(weightRow.v).toFixed(1) : null;
  const prevAvgWeight = prevWeightRow?.v != null ? +Number(prevWeightRow.v).toFixed(1) : null;
  const latestWaist = waistRow?.value != null ? Number(waistRow.value) : null;
  const prevWaist = prevWaistRow?.value != null ? Number(prevWaistRow.value) : null;

  return {
    weekStart,
    weekEnd,
    avgWeight,
    prevAvgWeight,
    weightChange:
      avgWeight != null && prevAvgWeight != null ? +(avgWeight - prevAvgWeight).toFixed(1) : null,
    latestWaist,
    prevWaist,
    waistChange:
      latestWaist != null && prevWaist != null ? +(latestWaist - prevWaist).toFixed(2) : null,
    plannedWorkouts: Number(workoutRow?.planned ?? 0),
    completedWorkouts: Number(workoutRow?.completed ?? 0),
    strengthSessions: strength,
    boxingSessions: boxing,
    aerobicMin: Math.round(aerobicMin),
    avgSessionRpe: rpes.length ? +(rpes.reduce((a, b) => a + b) / rpes.length).toFixed(1) : null,
    avgSleepH: sleepRow?.v != null ? +(Number(sleepRow.v) / 60).toFixed(1) : null,
    avgHrv: hrvRhrRow?.hrv != null ? Math.round(Number(hrvRhrRow.hrv)) : null,
    avgRhr: hrvRhrRow?.rhr != null ? Math.round(Number(hrvRhrRow.rhr)) : null,
    avgSoreness: sorenessRow?.v != null ? +Number(sorenessRow.v).toFixed(1) : null,
    avgKcal: nutritionRow?.kcal != null ? Math.round(Number(nutritionRow.kcal)) : null,
    avgProtein: nutritionRow?.protein != null ? Math.round(Number(nutritionRow.protein)) : null,
    proteinDays: Number(proteinDaysRow?.v ?? 0),
    kcalAdherenceDays: Number(kcalAdherenceDays?.v ?? 0),
    loggedDays: Number(nutritionRow?.days ?? 0),
    stepsAvg: stepsRow?.v != null ? Math.round(Number(stepsRow.v)) : null,
    measurementDays: Number(measurementDaysRow?.v ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Scores — EXECUTION (did I follow the plan?) vs OUTCOME (did the body respond?)
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function executionScore(a: WeekAggregates): { score: number; parts: Record<string, number> } {
  const parts: Record<string, number> = {
    training: clamp01(
      a.plannedWorkouts > 0 ? a.completedWorkouts / a.plannedWorkouts
        : (a.strengthSessions + a.boxingSessions) / 5
    ),
    protein: clamp01(a.proteinDays / 6),
    calories: clamp01(a.loggedDays > 0 ? a.kcalAdherenceDays / Math.min(7, a.loggedDays) : 0),
    logging: clamp01(a.loggedDays / 7),
    movement: a.stepsAvg != null ? clamp01(a.stepsAvg / 6000) : 0.5,
    measurement: clamp01(a.measurementDays / 5),
  };
  const weights: Record<string, number> = {
    training: 0.3, protein: 0.2, calories: 0.15, logging: 0.1, movement: 0.15, measurement: 0.1,
  };
  let s = 0;
  for (const k of Object.keys(parts)) s += parts[k] * weights[k];
  return { score: Math.round(s * 100), parts };
}

export function outcomeScore(
  a: WeekAggregates,
  expected: Record<string, { min?: number; max?: number; target?: number }>
): { score: number; parts: Record<string, number | null> } {
  const parts: Record<string, number | null> = {};

  // weight: within expected band = 1, linear falloff outside
  const wExp = expected.weight_change_lb;
  if (a.weightChange != null && wExp?.min != null && wExp?.max != null) {
    if (a.weightChange >= wExp.min && a.weightChange <= wExp.max) parts.weight = 1;
    else {
      const dist = a.weightChange < wExp.min ? wExp.min - a.weightChange : a.weightChange - wExp.max;
      parts.weight = clamp01(1 - dist / 1.5);
    }
  } else parts.weight = null;

  const waistExp = expected.waist_change_in;
  if (a.waistChange != null && waistExp) {
    const max = waistExp.max ?? 0;
    parts.waist = a.waistChange <= max ? 1 : clamp01(1 - (a.waistChange - max) / 0.5);
  } else parts.waist = null;

  // recovery response: sleep near target + HRV/RHR stability (coarse)
  parts.sleep = a.avgSleepH != null ? clamp01(a.avgSleepH / (expected.sleep_avg_h?.target ?? 7)) : null;
  parts.aerobic = clamp01(a.aerobicMin / (expected.aerobic_min?.target ?? 90));

  const usable = Object.entries(parts).filter(([, v]) => v != null) as [string, number][];
  const score = usable.length
    ? Math.round((usable.reduce((s, [, v]) => s + v, 0) / usable.length) * 100)
    : 0;
  return { score, parts };
}

/** Coach decision logic from the spec. */
export function coachDecisionFor(execution: number, outcome: number): {
  decision: "maintain" | "adjust_assumptions" | "focus_adherence";
  reasoning: string;
} {
  const execHigh = execution >= 75;
  const outcomeGood = outcome >= 70;
  if (execHigh && outcomeGood)
    return { decision: "maintain", reasoning: "Execution high and outcomes on track — keep the current plan." };
  if (execHigh && !outcomeGood)
    return {
      decision: "adjust_assumptions",
      reasoning:
        "Execution was high but the body did not respond as predicted — investigate assumptions (calorie targets, recovery, measurement noise) and consider modifying the plan.",
    };
  return {
    decision: "focus_adherence",
    reasoning:
      "Execution was low — do not change the physiological plan yet; focus on adherence first and re-evaluate next week.",
  };
}

// ---------------------------------------------------------------------------
// Weekly review assembly
// ---------------------------------------------------------------------------

export async function runWeeklyReview(weekStartArg?: string) {
  const weekStart = weekStartArg ?? weekStartOf(addDays(todayLocal(), -7));
  await ensureExpectedOutcomes(weekStart);
  const a = await computeWeekAggregates(weekStart);

  const expectedRows = await query(
    `select metric, expected from expected_outcomes where week_start=$1`, [weekStart]);
  const expected: Record<string, { min?: number; max?: number; target?: number }> = {};
  for (const r of expectedRows) expected[r.metric] = r.expected;

  const actuals: Record<string, unknown> = {
    weight_change_lb: a.weightChange,
    waist_change_in: a.waistChange,
    strength_sessions: a.strengthSessions,
    boxing_sessions: a.boxingSessions,
    aerobic_min: a.aerobicMin,
    steps_avg: a.stepsAvg,
    protein_days: a.proteinDays,
    sleep_avg_h: a.avgSleepH,
  };
  for (const [metric, value] of Object.entries(actuals)) {
    await query(
      `insert into actual_outcomes (week_start, metric, actual)
       values ($1,$2,$3)
       on conflict (week_start, metric) do update set actual=excluded.actual, computed_at=now()`,
      [weekStart, metric, JSON.stringify({ value })]
    );
  }

  const exec = executionScore(a);
  const out = outcomeScore(a, expected);
  const decision = coachDecisionFor(exec.score, out.score);

  const review = await queryOne(
    `insert into weekly_reviews (week_start, body, training, recovery, nutrition, movement,
       execution_score, outcome_score, summary, coach_decision)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (week_start) do update set
       body=excluded.body, training=excluded.training, recovery=excluded.recovery,
       nutrition=excluded.nutrition, movement=excluded.movement,
       execution_score=excluded.execution_score, outcome_score=excluded.outcome_score,
       summary=excluded.summary, coach_decision=excluded.coach_decision
     returning *`,
    [
      weekStart,
      JSON.stringify({ avg_weight: a.avgWeight, weight_change: a.weightChange, waist: a.latestWaist, waist_change: a.waistChange }),
      JSON.stringify({ planned: a.plannedWorkouts, completed: a.completedWorkouts, strength_sessions: a.strengthSessions, boxing_sessions: a.boxingSessions, aerobic_min: a.aerobicMin, avg_session_rpe: a.avgSessionRpe }),
      JSON.stringify({ avg_sleep_h: a.avgSleepH, avg_hrv: a.avgHrv, avg_rhr: a.avgRhr, avg_soreness: a.avgSoreness }),
      JSON.stringify({ avg_kcal: a.avgKcal, avg_protein: a.avgProtein, protein_days: a.proteinDays, kcal_adherence_days: a.kcalAdherenceDays, logged_days: a.loggedDays }),
      JSON.stringify({ steps_avg: a.stepsAvg }),
      exec.score,
      out.score,
      `Week of ${weekStart}: execution ${exec.score}/100, outcome ${out.score}/100. ` +
        `Weight ${a.weightChange != null ? (a.weightChange > 0 ? "+" : "") + a.weightChange + " lb" : "n/a"}, ` +
        `waist ${a.waistChange != null ? (a.waistChange > 0 ? "+" : "") + a.waistChange + " in" : "n/a"}, ` +
        `${a.completedWorkouts}/${a.plannedWorkouts || "?"} workouts, protein target hit ${a.proteinDays}/7 days.`,
      decision.decision,
    ]
  );

  await query(
    `insert into coach_decisions (kind, decision, reasoning, context, status)
     values ('plan_change', $1, $2, $3, 'proposed')`,
    [decision.decision, decision.reasoning,
     JSON.stringify({ week_start: weekStart, execution: exec, outcome: out })]
  );

  // Update personal energy model when we have enough signal
  if (a.avgKcal != null && a.weightChange != null && a.loggedDays >= 5) {
    // 1 lb ≈ 3500 kcal
    const tdee = Math.round(a.avgKcal - (a.weightChange * 3500) / 7);
    await query(
      `insert into energy_model_estimates (window_start, window_end, avg_intake_kcal, avg_steps, avg_training_min, weight_change_lb_wk, estimated_tdee_kcal, confidence, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [weekStart, a.weekEnd, a.avgKcal, a.stepsAvg, null, a.weightChange, tdee,
       Math.min(0.9, 0.3 + a.loggedDays * 0.08),
       "Weekly observed energy balance; single-week estimates are noisy — trend across weeks before trusting."]
    );
  }

  return { review, aggregates: a, execution: exec, outcome: out, decision };
}
