/* GET /api/experiment — 4-week experiment dashboard data */
import { route, json } from "@/lib/api";
import { query, queryOne } from "@/lib/db";

export const GET = route(async () => {
  const tz = process.env.COACH_TZ || "America/New_York";
  const [
    plan, weightTrend, waistTrend, reviews, decisions, corrections,
    workoutStats, mobility, energyModel, nutritionDays, stepsRow, sleepRow,
  ] = await Promise.all([
    queryOne(`select * from training_plans where status='active' order by created_at desc limit 1`),
    query(
      `select taken_at::date::text as date, round(avg(value)::numeric,1) as value
       from measurements where kind='weight' group by 1 order by 1`
    ),
    query(
      `select taken_at::date::text as date, round(avg(value)::numeric,2) as value
       from measurements where kind='waist' group by 1 order by 1`
    ),
    query(`select * from weekly_reviews order by week_start`),
    query(
      `select status, count(*) n from coach_decisions
       where kind in ('daily_training','meal_advice','reschedule','nutrition_target')
       group by status`
    ),
    queryOne(`select count(*) n from meal_items where corrected`),
    queryOne(
      `select count(*) filter (where status='completed') completed,
              count(*) filter (where status='skipped') skipped,
              count(*) filter (where status='rescheduled') rescheduled,
              count(*) total
       from workouts`
    ),
    query(
      `select area, side, movement, finding, severity, trend, status, first_observed, last_observed
       from mobility_findings where resolved_at is null order by severity desc nulls last`
    ),
    query(`select * from energy_model_estimates order by window_start`),
    query(
      `select (eaten_at at time zone $1)::date::text as date,
              round(sum(kcal)) kcal, round(sum(protein_g)) protein_g
       from meals where status <> 'planned' group by 1 order by 1`,
      [tz]
    ),
    queryOne(`select round(avg(value)) v from activity_metrics where kind='steps' and date > current_date - 28`),
    queryOne(`select round(avg(value)) v from recovery_metrics where kind='sleep_duration_min' and date > current_date - 28`),
  ]);

  return json({
    plan,
    weight_trend: weightTrend,
    waist_trend: waistTrend,
    weekly_reviews: reviews,
    coach_decisions_by_status: decisions,
    meal_corrections: Number(corrections?.n ?? 0),
    workout_stats: workoutStats,
    mobility_findings: mobility,
    energy_model: energyModel,
    nutrition_days: nutritionDays,
    avg_steps_28d: stepsRow?.v ?? null,
    avg_sleep_min_28d: sleepRow?.v ?? null,
  });
});
