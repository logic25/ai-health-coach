/* HealthStateSnapshot — the deterministic structured state assembled before
   every major AI interaction. The LLM reasons over THIS, never over old chat
   transcripts. If a fact is in the database it appears here (memory-failure
   target: zero). */

import { query, queryOne, todayLocal, weekStartOf, addDays } from "./db";

export interface HealthStateSnapshot {
  generated_at: string;
  today: string;
  profile: Record<string, unknown> | null;
  goals: Record<string, unknown>[];
  measurements: {
    latest: Record<string, unknown>[]; // latest of each kind
    weight_trend: { date: string; value: number }[];
    waist_trend: { date: string; value: number }[];
  };
  daily_state: Record<string, unknown> | null;
  recovery: {
    score: number | null;
    band: string | null;
    recent_metrics: Record<string, unknown>[]; // last 7 days
  };
  mobility_findings: Record<string, unknown>[];
  active_symptoms: Record<string, unknown>[];
  injury_limitations: Record<string, unknown>[];
  training: {
    plan: Record<string, unknown> | null;
    recent_workouts: Record<string, unknown>[];
    upcoming_workouts: Record<string, unknown>[];
    todays_workout: Record<string, unknown> | null;
    recent_performances: Record<string, unknown>[];
  };
  nutrition: {
    target: Record<string, unknown> | null;
    today: {
      kcal: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      meals: Record<string, unknown>[];
    };
    recent_days: { date: string; kcal: number; protein_g: number }[];
  };
  activity: { recent: Record<string, unknown>[] };
  calendar: { today_events: Record<string, unknown>[]; upcoming_events: Record<string, unknown>[] };
  recent_coach_decisions: Record<string, unknown>[];
  coach_observations: Record<string, unknown>[];
  current_week: {
    week_start: string;
    expected_outcomes: Record<string, unknown>[];
  };
}

export async function buildSnapshot(): Promise<HealthStateSnapshot> {
  const today = todayLocal();
  const weekStart = weekStartOf(today);

  const [
    profile,
    goals,
    latestMeasurements,
    weightTrend,
    waistTrend,
    dailyState,
    recentRecovery,
    mobility,
    symptoms,
    limitations,
    plan,
    recentWorkouts,
    upcomingWorkouts,
    todaysWorkout,
    recentPerformances,
    target,
    todaysMeals,
    recentDays,
    recentActivity,
    todayEvents,
    upcomingEvents,
    decisions,
    observations,
    expected,
  ] = await Promise.all([
    queryOne("select * from user_profile limit 1"),
    query("select * from goals where status='active' order by priority, created_at"),
    query(
      `select distinct on (kind) * from measurements
       order by kind, taken_at desc`
    ),
    query(
      `select taken_at::date::text as date, avg(value)::numeric(6,1) as value
       from measurements where kind='weight' and taken_at > now() - interval '28 days'
       group by 1 order by 1`
    ),
    query(
      `select taken_at::date::text as date, avg(value)::numeric(6,2) as value
       from measurements where kind='waist' and taken_at > now() - interval '60 days'
       group by 1 order by 1`
    ),
    queryOne("select * from daily_states where date = $1", [today]),
    query(
      `select date::text, kind, value, unit, source from recovery_metrics
       where date > current_date - 8 order by date desc, kind`
    ),
    query(
      `select * from mobility_findings where resolved_at is null
       order by severity desc nulls last, last_observed desc`
    ),
    query(
      `select * from symptoms where status in ('active','monitoring')
       order by onset_at desc limit 20`
    ),
    query("select * from injury_limitations where status='active'"),
    queryOne("select * from training_plans where status='active' order by created_at desc limit 1"),
    query(
      `select w.*, coalesce(s.session_rpe, null) as session_rpe
       from workouts w
       left join workout_sessions s on s.workout_id = w.id
       where w.scheduled_date >= current_date - 14 and w.scheduled_date < $1::date
       order by w.scheduled_date desc limit 14`,
      [today]
    ),
    query(
      `select * from workouts where scheduled_date > $1::date
       and status in ('planned','scheduled') order by scheduled_date limit 7`,
      [today]
    ),
    queryOne(
      `select * from workouts where scheduled_date = $1::date
       order by created_at desc limit 1`,
      [today]
    ),
    query(
      `select p.recorded_at, e.name as exercise, p.set_number, p.reps, p.load_lb,
              p.time_seconds, p.rpe, p.notes
       from exercise_performances p join exercises e on e.id = p.exercise_id
       where p.recorded_at > now() - interval '14 days'
       order by p.recorded_at desc limit 60`
    ),
    queryOne(
      `select * from nutrition_targets where date = $1
       union all
       select * from nutrition_targets where date is null
       limit 1`,
      [today]
    ),
    query(
      `select m.*, (
         select json_agg(json_build_object(
           'description', i.description, 'grams', i.grams, 'quantity', i.quantity,
           'unit', i.unit, 'kcal', i.kcal, 'protein_g', i.protein_g,
           'confidence', i.confidence, 'corrected', i.corrected))
         from meal_items i where i.meal_id = m.id
       ) as items
       from meals m
       where (m.eaten_at at time zone $2)::date = $1::date and m.status <> 'planned'
       order by m.eaten_at`,
      [today, process.env.COACH_TZ || "America/New_York"]
    ),
    query(
      `select (eaten_at at time zone $1)::date::text as date,
              round(sum(kcal)) as kcal, round(sum(protein_g)) as protein_g
       from meals where eaten_at > now() - interval '10 days' and status <> 'planned'
       group by 1 order by 1 desc limit 7`,
      [process.env.COACH_TZ || "America/New_York"]
    ),
    query(
      `select date::text, kind, value, unit from activity_metrics
       where date > current_date - 8 order by date desc`
    ),
    query(
      `select title, start_at, end_at, all_day, busy from calendar_events
       where start_at >= $1::date and start_at < $1::date + 1 order by start_at`,
      [today]
    ),
    query(
      `select title, start_at, end_at, all_day, busy from calendar_events
       where start_at >= $1::date + 1 and start_at < $1::date + 7 order by start_at limit 30`,
      [today]
    ),
    query(
      `select kind, decision, reasoning, status, user_response, made_at
       from coach_decisions order by made_at desc limit 15`
    ),
    query(
      `select category, content, status, confidence, created_at
       from coach_observations where superseded_by is null
       order by created_at desc limit 25`
    ),
    query("select metric, expected, notes from expected_outcomes where week_start = $1", [
      weekStart,
    ]),
  ]);

  const totals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const m of todaysMeals) {
    totals.kcal += Number(m.kcal) || 0;
    totals.protein_g += Number(m.protein_g) || 0;
    totals.carbs_g += Number(m.carbs_g) || 0;
    totals.fat_g += Number(m.fat_g) || 0;
  }

  return {
    generated_at: new Date().toISOString(),
    today,
    profile,
    goals,
    measurements: {
      latest: latestMeasurements,
      weight_trend: weightTrend,
      waist_trend: waistTrend,
    },
    daily_state: dailyState,
    recovery: {
      score: (dailyState?.recovery_score as number) ?? null,
      band: (dailyState?.recovery_band as string) ?? null,
      recent_metrics: recentRecovery,
    },
    mobility_findings: mobility,
    active_symptoms: symptoms,
    injury_limitations: limitations,
    training: {
      plan,
      recent_workouts: recentWorkouts,
      upcoming_workouts: upcomingWorkouts,
      todays_workout: todaysWorkout,
      recent_performances: recentPerformances,
    },
    nutrition: {
      target,
      today: {
        kcal: Math.round(totals.kcal),
        protein_g: Math.round(totals.protein_g),
        carbs_g: Math.round(totals.carbs_g),
        fat_g: Math.round(totals.fat_g),
        meals: todaysMeals,
      },
      recent_days: recentDays,
    },
    activity: { recent: recentActivity },
    calendar: { today_events: todayEvents, upcoming_events: upcomingEvents },
    recent_coach_decisions: decisions,
    coach_observations: observations,
    current_week: { week_start: weekStart, expected_outcomes: expected },
  };
}

/** Compact, token-efficient text rendering of the snapshot for prompts. */
export function renderSnapshot(s: HealthStateSnapshot): string {
  return JSON.stringify(s, null, 1);
}

export { todayLocal, weekStartOf, addDays };
