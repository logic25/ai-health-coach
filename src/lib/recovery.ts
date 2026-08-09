/* Recovery scoring — deterministic, explainable.
   Blends sleep duration, HRV (vs personal 14-day baseline), resting HR
   (vs baseline), yesterday's training load, and subjective soreness.
   Missing inputs reduce coverage instead of failing. */

import { query, queryOne, todayLocal } from "./db";

export interface RecoveryInputs {
  sleepMin: number | null;
  hrvMs: number | null;
  hrvBaseline: number | null;
  rhrBpm: number | null;
  rhrBaseline: number | null;
  soreness: number | null; // 1..10
  yesterdaySessionRpe: number | null;
}

export interface RecoveryResult {
  score: number; // 0..100
  band: "green" | "yellow" | "red";
  components: Record<string, { value: number | null; score: number | null; weight: number }>;
}

export function computeRecoveryScore(inp: RecoveryInputs): RecoveryResult {
  const components: RecoveryResult["components"] = {};

  // Sleep: 8h -> 100, 6h -> 50, <5h -> 0
  let sleepScore: number | null = null;
  if (inp.sleepMin != null) {
    sleepScore = Math.max(0, Math.min(100, ((inp.sleepMin - 300) / 180) * 100));
  }
  components.sleep = { value: inp.sleepMin, score: sleepScore, weight: 0.35 };

  // HRV vs baseline: at/above baseline -> 100; 30% below -> 0
  let hrvScore: number | null = null;
  if (inp.hrvMs != null && inp.hrvBaseline != null && inp.hrvBaseline > 0) {
    const ratio = inp.hrvMs / inp.hrvBaseline;
    hrvScore = Math.max(0, Math.min(100, ((ratio - 0.7) / 0.3) * 100));
  }
  components.hrv = { value: inp.hrvMs, score: hrvScore, weight: 0.25 };

  // RHR vs baseline: at/below baseline -> 100; +10 bpm -> 0
  let rhrScore: number | null = null;
  if (inp.rhrBpm != null && inp.rhrBaseline != null) {
    const delta = inp.rhrBpm - inp.rhrBaseline;
    rhrScore = Math.max(0, Math.min(100, (1 - delta / 10) * 100));
  }
  components.rhr = { value: inp.rhrBpm, score: rhrScore, weight: 0.2 };

  // Soreness: 1 -> 100, 10 -> 0
  let soreScore: number | null = null;
  if (inp.soreness != null) {
    soreScore = Math.max(0, Math.min(100, ((10 - inp.soreness) / 9) * 100));
  }
  components.soreness = { value: inp.soreness, score: soreScore, weight: 0.1 };

  // Yesterday's load: RPE <=6 -> 100, RPE 10 -> 40
  let loadScore: number | null = null;
  if (inp.yesterdaySessionRpe != null) {
    loadScore = Math.max(40, Math.min(100, 100 - (inp.yesterdaySessionRpe - 6) * 15));
  }
  components.load = { value: inp.yesterdaySessionRpe, score: loadScore, weight: 0.1 };

  let weighted = 0;
  let weightSum = 0;
  for (const c of Object.values(components)) {
    if (c.score != null) {
      weighted += c.score * c.weight;
      weightSum += c.weight;
    }
  }
  // No data at all -> neutral 70 (unknown, assume trainable)
  const score = weightSum === 0 ? 70 : Math.round(weighted / weightSum);
  const band = score >= 70 ? "green" : score >= 50 ? "yellow" : "red";
  return { score, band, components };
}

/** Compute and persist today's recovery score from stored metrics. */
export async function refreshTodayRecovery(date?: string): Promise<RecoveryResult> {
  const day = date ?? todayLocal();

  const [metrics, baselines, dailyState, yesterdaySession] = await Promise.all([
    query(
      `select kind, value from recovery_metrics where date = $1`,
      [day]
    ),
    queryOne(
      `select
         avg(value) filter (where kind='hrv_ms') as hrv_baseline,
         avg(value) filter (where kind='resting_hr_bpm') as rhr_baseline
       from recovery_metrics
       where date >= $1::date - 14 and date < $1::date`,
      [day]
    ),
    queryOne(`select soreness from daily_states where date = $1`, [day]),
    queryOne(
      `select s.session_rpe from workout_sessions s
       where (s.started_at at time zone $2)::date = $1::date - 1
       order by s.started_at desc limit 1`,
      [day, process.env.COACH_TZ || "America/New_York"]
    ),
  ]);

  const byKind: Record<string, number> = {};
  for (const m of metrics) byKind[m.kind] = Number(m.value);

  const result = computeRecoveryScore({
    sleepMin: byKind.sleep_duration_min ?? null,
    hrvMs: byKind.hrv_ms ?? null,
    hrvBaseline: baselines?.hrv_baseline != null ? Number(baselines.hrv_baseline) : null,
    rhrBpm: byKind.resting_hr_bpm ?? null,
    rhrBaseline: baselines?.rhr_baseline != null ? Number(baselines.rhr_baseline) : null,
    soreness: dailyState?.soreness ?? null,
    yesterdaySessionRpe: yesterdaySession?.session_rpe != null ? Number(yesterdaySession.session_rpe) : null,
  });

  await query(
    `insert into daily_states (date, recovery_score, recovery_band, recovery_detail, source)
     values ($1,$2,$3,$4,'computed')
     on conflict (date) do update set
       recovery_score=$2, recovery_band=$3, recovery_detail=$4, updated_at=now()`,
    [day, result.score, result.band, JSON.stringify(result.components)]
  );

  return result;
}
