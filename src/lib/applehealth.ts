/* Apple Health ingestion — normalization layer.
   A HealthKit bridge POSTs JSON to /api/health/import (schema documented in
   docs/apple-health-schema.md). Nothing in the app depends on direct
   HealthKit access. Data is normalized into measurements, recovery_metrics,
   activity_metrics and workout_sessions with source='apple_health'. */

import { createHash } from "crypto";
import { z } from "zod";
import { query, queryOne } from "./db";

const sampleSchema = z.object({
  type: z.enum([
    "weight",
    "body_fat_pct",
    "resting_heart_rate",
    "hrv",
    "sleep",
    "steps",
    "active_calories",
    "exercise_minutes",
    "distance",
    "vo2_max",
    "respiratory_rate",
  ]),
  value: z.number().optional(),
  unit: z.string().optional(),
  date: z.string(), // YYYY-MM-DD the sample belongs to (local)
  start: z.string().optional(), // ISO timestamps where meaningful
  end: z.string().optional(),
  // sleep only: minutes by stage
  stages: z
    .object({
      in_bed: z.number().optional(),
      core: z.number().optional(),
      deep: z.number().optional(),
      rem: z.number().optional(),
      awake: z.number().optional(),
    })
    .optional(),
});

const workoutSchema = z.object({
  external_id: z.string(),
  activity_type: z.string(), // e.g. 'Boxing', 'Traditional Strength Training', 'Walking'
  start: z.string(),
  end: z.string(),
  duration_min: z.number(),
  active_kcal: z.number().optional(),
  avg_heart_rate: z.number().optional(),
  max_heart_rate: z.number().optional(),
  distance_mi: z.number().optional(),
  heart_rate_series: z
    .array(z.object({ t: z.string(), bpm: z.number() }))
    .optional(),
});

export const importPayloadSchema = z.object({
  source: z.string().default("apple_health"),
  device: z.string().optional(),
  exported_at: z.string().optional(),
  samples: z.array(sampleSchema).default([]),
  workouts: z.array(workoutSchema).default([]),
});

export type ImportPayload = z.infer<typeof importPayloadSchema>;

const KG_TO_LB = 2.20462;
const KM_TO_MI = 0.621371;

export interface ImportResult {
  batchId: string;
  accepted: number;
  skipped: number;
  errors: { index: number; error: string }[];
}

export async function importHealthPayload(raw: unknown): Promise<ImportResult> {
  const payload = importPayloadSchema.parse(raw);
  const hash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");

  const batch = await queryOne(
    `insert into health_import_batches (source, payload_hash, item_count)
     values ($1,$2,$3) returning id`,
    [payload.source, hash, payload.samples.length + payload.workouts.length]
  );
  const batchId = batch!.id as string;
  const provenance = JSON.stringify({ import_batch_id: batchId, device: payload.device ?? null });

  let accepted = 0;
  let skipped = 0;
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < payload.samples.length; i++) {
    const s = payload.samples[i];
    try {
      switch (s.type) {
        case "weight": {
          if (s.value == null) throw new Error("weight requires value");
          const lb = s.unit === "kg" ? +(s.value * KG_TO_LB).toFixed(1) : s.value;
          // dedupe: one apple_health weight per day
          const dup = await queryOne(
            `select id from measurements where kind='weight' and source='apple_health'
             and taken_at::date = $1::date`,
            [s.date]
          );
          if (dup) { skipped++; break; }
          await query(
            `insert into measurements (kind, value, unit, method, timing, taken_at, source, provenance)
             values ('weight',$1,'lb','scale','morning',coalesce($2::timestamptz, $3::date + interval '7 hours'),'apple_health',$4)`,
            [lb, s.start ?? null, s.date, provenance]
          );
          accepted++;
          break;
        }
        case "body_fat_pct": {
          if (s.value == null) throw new Error("body_fat_pct requires value");
          await query(
            `insert into measurements (kind, value, unit, taken_at, source, provenance)
             values ('body_fat_pct',$1,'pct',coalesce($2::timestamptz, $3::date + interval '7 hours'),'apple_health',$4)`,
            [s.value, s.start ?? null, s.date, provenance]
          );
          accepted++;
          break;
        }
        case "resting_heart_rate":
        case "hrv":
        case "vo2_max":
        case "respiratory_rate": {
          if (s.value == null) throw new Error(`${s.type} requires value`);
          const kindMap: Record<string, [string, string]> = {
            resting_heart_rate: ["resting_hr_bpm", "bpm"],
            hrv: ["hrv_ms", "ms"],
            vo2_max: ["vo2_max", "ml/kg/min"],
            respiratory_rate: ["respiratory_rate", "brpm"],
          };
          const [kind, unit] = kindMap[s.type];
          await query(
            `insert into recovery_metrics (date, kind, value, unit, taken_at, source)
             values ($1,$2,$3,$4,$5,'apple_health')
             on conflict (date, kind, source) do update set value=excluded.value, taken_at=excluded.taken_at`,
            [s.date, kind, s.value, unit, s.start ?? null]
          );
          accepted++;
          break;
        }
        case "sleep": {
          const stages = s.stages ?? {};
          const totalAsleep =
            s.value ??
            (stages.core ?? 0) + (stages.deep ?? 0) + (stages.rem ?? 0);
          if (!totalAsleep) throw new Error("sleep requires value (minutes) or stages");
          const rows: [string, number][] = [["sleep_duration_min", totalAsleep]];
          if (stages.deep != null) rows.push(["sleep_deep_min", stages.deep]);
          if (stages.rem != null) rows.push(["sleep_rem_min", stages.rem]);
          if (stages.core != null) rows.push(["sleep_core_min", stages.core]);
          if (stages.awake != null) rows.push(["sleep_awake_min", stages.awake]);
          for (const [kind, value] of rows) {
            await query(
              `insert into recovery_metrics (date, kind, value, unit, taken_at, detail, source)
               values ($1,$2,$3,'min',$4,$5,'apple_health')
               on conflict (date, kind, source) do update set value=excluded.value, detail=excluded.detail`,
              [s.date, kind, value, s.end ?? null,
               JSON.stringify({ start: s.start ?? null, end: s.end ?? null })]
            );
          }
          accepted++;
          break;
        }
        case "steps":
        case "active_calories":
        case "exercise_minutes":
        case "distance": {
          if (s.value == null) throw new Error(`${s.type} requires value`);
          const kindMap: Record<string, [string, string, number]> = {
            steps: ["steps", "count", 1],
            active_calories: ["active_kcal", "kcal", 1],
            exercise_minutes: ["exercise_min", "min", 1],
            distance: ["distance_mi", "mi", s.unit === "km" ? KM_TO_MI : 1],
          };
          const [kind, unit, factor] = kindMap[s.type];
          await query(
            `insert into activity_metrics (date, kind, value, unit, source)
             values ($1,$2,$3,$4,'apple_health')
             on conflict (date, kind, source) do update set value=excluded.value`,
            [s.date, kind, +(s.value * factor).toFixed(2), unit]
          );
          accepted++;
          break;
        }
      }
    } catch (e) {
      errors.push({ index: i, error: e instanceof Error ? e.message : String(e) });
    }
  }

  for (let i = 0; i < payload.workouts.length; i++) {
    const w = payload.workouts[i];
    try {
      const dup = await queryOne(
        `select id from workout_sessions where external_id = $1`,
        [w.external_id]
      );
      if (dup) { skipped++; continue; }
      await query(
        `insert into workout_sessions (started_at, ended_at, source, external_id, raw, notes)
         values ($1,$2,'apple_health',$3,$4,$5)`,
        [w.start, w.end, w.external_id,
         JSON.stringify({
           activity_type: w.activity_type,
           duration_min: w.duration_min,
           active_kcal: w.active_kcal ?? null,
           avg_heart_rate: w.avg_heart_rate ?? null,
           max_heart_rate: w.max_heart_rate ?? null,
           distance_mi: w.distance_mi ?? null,
           heart_rate_series: w.heart_rate_series ?? [],
           import_batch_id: batchId,
         }),
         `${w.activity_type} (${Math.round(w.duration_min)} min, Apple Health)`]
      );
      accepted++;
    } catch (e) {
      errors.push({ index: payload.samples.length + i, error: e instanceof Error ? e.message : String(e) });
    }
  }

  await query(
    `update health_import_batches set accepted=$2, skipped=$3, errors=$4 where id=$1`,
    [batchId, accepted, skipped, JSON.stringify(errors)]
  );

  return { batchId, accepted, skipped, errors };
}
