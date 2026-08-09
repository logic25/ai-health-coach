/* Development seed data. Idempotent: safe to run repeatedly.
   All values are editable baselines, not hard-coded truths.
   Usage: npm run db:seed */
import { readFileSync } from "fs";
import { join } from "path";
import { Client } from "pg";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.COACH_TZ || "America/New_York",
  }).format(new Date());
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const db = new Client({
    connectionString: url,
    ssl: url.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
  });
  await db.connect();

  // ---- profile -------------------------------------------------------------
  const profile = await db.query("select id from user_profile limit 1");
  if (profile.rows.length === 0) {
    await db.query(
      `insert into user_profile (name, email, sex, preferences) values ($1, $2, $3, $4)`,
      [
        "Eric",
        "erussell25@gmail.com",
        "male",
        JSON.stringify({
          preferred_rhythm: [
            "wake",
            "bathroom",
            "weigh",
            "train",
            "first meal ~12-1pm",
            "eating window until ~8-9pm",
            "family / wind down",
            "sleep",
          ],
          preferred_workout_time: "07:30",
          preferred_workout_slot: "first thing in the morning",
          eating_window: { start: "12:00", end: "20:30" },
          cardio: ["boxing"],
          equipment: ["dumbbells", "kettlebell", "bands", "pullup_bar", "bench"],
          rhythm_note:
            "Preferred rhythm is a default, not a rule — adapt around real life instead of marking days failed.",
        }),
      ]
    );
    console.log("seeded user profile");
  }

  // ---- goals ---------------------------------------------------------------
  const goals: Array<[string, string, object | null, number]> = [
    ["body_comp", "Reduce waist and body fat while keeping muscle", { metric: "waist_in", direction: "down", rate: "0.25 in / 2 wks" }, 1],
    ["body_comp", "Lose ~0.7-1.2 lb per week", { metric: "weight_lb", direction: "down", rate: "0.7-1.2 lb/wk" }, 1],
    ["strength", "Maintain or improve strength during the cut", { metric: "strength", direction: "maintain_or_up" }, 2],
    ["aerobic", "90+ aerobic minutes per week incl. boxing", { metric: "aerobic_min_wk", target: 90 }, 2],
    ["mobility", "Improve right-hip external rotation (pigeon) toward left-side quality", { metric: "pigeon_right", direction: "improve" }, 3],
    ["habit", "Train 4x strength + 1 boxing per week, >=180g protein 6 days/wk", { metric: "adherence" }, 1],
  ];
  for (const [kind, description, target, priority] of goals) {
    await db.query(
      `insert into goals (kind, description, target, priority, status)
       select $1, $2, $3, $4, 'active'
       where not exists (select 1 from goals where description = $2)`,
      [kind, description, target ? JSON.stringify(target) : null, priority]
    );
  }

  // ---- baseline measurements ----------------------------------------------
  const haveWeight = await db.query(
    "select 1 from measurements where kind='weight' and source='seed'"
  );
  if (haveWeight.rows.length === 0) {
    await db.query(
      `insert into measurements (kind, value, unit, method, timing, taken_at, source, notes)
       values ('weight', 190.9, 'lb', 'scale', 'morning', now(), 'seed',
               'Development baseline — editable')`
    );
    await db.query(
      `insert into measurements (kind, value, unit, location, method, state, timing, taken_at, source, notes)
       values ('waist', 38.5, 'in', 'navel', 'tape', 'relaxed', 'morning', now(), 'seed',
               'Measured at belly button / navel, relaxed, morning. Development baseline — editable')`
    );
    console.log("seeded baseline measurements");
  }

  // ---- known mobility asymmetry -------------------------------------------
  await db.query(
    `insert into mobility_findings (area, side, movement, finding, severity, status, confidence, source, notes)
     select 'hip', 'right', 'pigeon pose',
            'Right pigeon pose substantially restricted / difficult', 4, 'confirmed', 0.95, 'seed',
            'Known asymmetry vs left side. Monitor; do not assume it causes unrelated pain.'
     where not exists (select 1 from mobility_findings where movement='pigeon pose' and side='right')`
  );
  await db.query(
    `insert into mobility_findings (area, side, movement, finding, severity, status, confidence, source, notes)
     select 'hip', 'left', 'pigeon pose', 'Left pigeon pose smooth / easy', 1, 'confirmed', 0.95, 'seed',
            'Baseline comparison side for right-hip restriction.'
     where not exists (select 1 from mobility_findings where movement='pigeon pose' and side='left')`
  );

  // ---- default nutrition target -------------------------------------------
  await db.query(
    `insert into nutrition_targets (date, kcal, protein_g, fat_g, fiber_g, eating_window_start, eating_window_end, rationale, source)
     select null, 2000, 185, 65, 30, '12:00', '20:30',
            'Starting default: moderate deficit at ~190 lb with high protein for muscle retention. Will adapt from observed response.',
            'seed'
     where not exists (select 1 from nutrition_targets where date is null)`
  );

  // ---- 4-week training plan template --------------------------------------
  const planExists = await db.query("select 1 from training_plans limit 1");
  if (planExists.rows.length === 0) {
    await db.query(
      `insert into training_plans (name, start_date, end_date, status, template, reasoning)
       values ($1, $2::date, $2::date + 27, 'active', $3, $4)`,
      [
        "4-Week Coaching Experiment — Block 1",
        today(),
        JSON.stringify({
          session_length_min: [30, 45],
          week: [
            { day: "Mon", focus: "lower_core", type: "strength" },
            { day: "Tue", focus: "upper_core", type: "strength" },
            { day: "Wed", focus: "conditioning", type: "boxing_or_zone2", optional: true },
            { day: "Thu", focus: "full_body", type: "strength" },
            { day: "Fri", focus: "mobility", type: "mobility", optional: true },
            { day: "Sat", focus: "lower_upper_alternate", type: "strength" },
            { day: "Sun", focus: "rest_or_walk", type: "recovery" },
          ],
          weekly_targets: {
            strength_sessions: 4,
            boxing_sessions: 1,
            aerobic_min: 90,
            steps_per_day: 6000,
          },
          structure: {
            warmup_min: 5,
            strength_blocks: 2,
            exercises_per_block: 3,
            mobility_finisher: true,
          },
          adaptation_rules: [
            "recovery red -> swap strength for mobility/walk or rest",
            "recovery yellow -> reduce volume ~30%, cap RPE at 7",
            "pain reported on movement -> substitute pattern, never push through joint pain",
            "missed day -> reflow week, never stack double strength on red/yellow recovery",
            "right-hip pigeon restriction -> include hip ER mobility in lower/full body days at tolerable regression",
          ],
        }),
        "Initial block: 4 strength days built from squat/hinge/push/pull patterns + boxing + daily-life movement, sized to 30-45 min sessions, with hip-mobility emphasis for the known right-side restriction.",
      ]
    );
    console.log("seeded training plan");
  }

  // ---- exercise library ----------------------------------------------------
  const exPath = join(__dirname, "..", "src", "db", "seed", "exercises.json");
  let exercises: Array<Record<string, unknown>> = [];
  try {
    exercises = JSON.parse(readFileSync(exPath, "utf8"));
  } catch {
    console.warn("exercises.json not found — skipping exercise seed");
  }
  for (const ex of exercises) {
    await db.query(
      `insert into exercises (slug, name, movement_pattern, primary_muscles, secondary_muscles,
         purpose, equipment, difficulty, instructions, form_cues, common_errors,
         regressions, progressions, contraindications, demo_url)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (slug) do update set
         name=excluded.name, movement_pattern=excluded.movement_pattern,
         primary_muscles=excluded.primary_muscles, secondary_muscles=excluded.secondary_muscles,
         purpose=excluded.purpose, equipment=excluded.equipment, difficulty=excluded.difficulty,
         instructions=excluded.instructions, form_cues=excluded.form_cues,
         common_errors=excluded.common_errors, regressions=excluded.regressions,
         progressions=excluded.progressions, contraindications=excluded.contraindications`,
      [
        ex.slug, ex.name, ex.movement_pattern, ex.primary_muscles, ex.secondary_muscles,
        ex.purpose, ex.equipment, ex.difficulty, ex.instructions, ex.form_cues,
        ex.common_errors, ex.regressions, ex.progressions, ex.contraindications,
        ex.demo_url ?? "",
      ]
    );
  }
  if (exercises.length) console.log(`seeded ${exercises.length} exercises`);

  console.log("seed complete");
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
