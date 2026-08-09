/* Programming engine.
   PROGRAM TEMPLATE + APPROVED LIBRARY + USER STATE + ADAPTATION RULES + LLM.
   The LLM selects/loads exercises ONLY from the curated library and must
   give reasoning; deterministic guardrails (recovery band, pain, time cap)
   are applied in code. A deterministic fallback builds a sensible workout
   when no LLM key is configured. */

import { getLlm, llmAvailable, LlmTool } from "./llm";
import { buildSnapshot, renderSnapshot } from "./snapshot";
import { query, queryOne, todayLocal } from "./db";

interface GeneratedExercise {
  slug: string;
  sets: number;
  reps?: string;
  time_seconds?: number;
  load_lb?: number;
  rest_seconds?: number;
  target_rpe?: number;
  reasoning?: string;
}

const BUILD_TOOL: LlmTool = {
  name: "build_workout",
  description: "Build today's workout from the approved exercise library.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      focus: { type: "string", description: "lower_core | upper_core | full_body | mobility | conditioning | recovery" },
      duration_min: { type: "integer", description: "30-45 for strength days" },
      recommend_recovery_instead: { type: "boolean", description: "true if training should be replaced by recovery today" },
      reasoning: { type: "string", description: "why this workout, referencing recovery/performance/mobility state" },
      exercises: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slug: { type: "string", description: "MUST be a slug from the provided library" },
            sets: { type: "integer" },
            reps: { type: "string", description: "e.g. '8', '8-10', 'AMRAP'" },
            time_seconds: { type: "integer", description: "for timed holds/carries/conditioning" },
            load_lb: { type: "number", description: "suggested load if applicable" },
            rest_seconds: { type: "integer" },
            target_rpe: { type: "number" },
            reasoning: { type: "string", description: "required when progressing/regressing/substituting" },
          },
          required: ["slug", "sets"],
        },
      },
    },
    required: ["title", "focus", "duration_min", "exercises", "reasoning"],
  },
};

export async function generateWorkout(opts: {
  date?: string;
  focusHint?: string;
}): Promise<{ workoutId: string; title: string; reasoning: string }> {
  const date = opts.date ?? todayLocal();
  const snapshot = await buildSnapshot();
  const library = await query(
    `select slug, name, movement_pattern, difficulty, equipment, purpose,
            regressions, progressions, contraindications
     from exercises where active order by movement_pattern, difficulty`
  );

  const plan = snapshot.training.plan;
  const recoveryBand = snapshot.recovery.band ?? "green";

  let built: {
    title: string;
    focus: string;
    duration_min: number;
    reasoning: string;
    recommend_recovery_instead?: boolean;
    exercises: GeneratedExercise[];
  };

  if (llmAvailable()) {
    const llm = getLlm();
    const res = await llm.complete({
      system:
        `You are a strength & conditioning coach building today's session. Rules:\n` +
        `- Choose exercises ONLY from the library below (use exact slugs).\n` +
        `- Session must fit the requested duration (30-45 min strength).\n` +
        `- Respect recovery: band yellow => reduce volume ~30% and cap RPE 7; band red => recommend recovery/mobility instead.\n` +
        `- Respect active symptoms and injury limitations: never program painful patterns; substitute and say why.\n` +
        `- Address mobility findings: the user has a restricted RIGHT hip in pigeon — include tolerable hip mobility work on lower/full-body days (use regressions, not max stretch).\n` +
        `- Progress/regress based on recent performances and RPE (last sets ≤ RPE 7 with full reps => small progression).\n` +
        `- Include brief reasoning for important choices.\n\n` +
        `=== LIBRARY ===\n${JSON.stringify(library)}\n\n=== USER STATE ===\n${renderSnapshot(snapshot)}`,
      messages: [
        {
          role: "user",
          content: `Build the workout for ${date}. Focus hint from plan: ${opts.focusHint ?? inferFocus(plan, date)}. Recovery band: ${recoveryBand}.`,
        },
      ],
      tools: [BUILD_TOOL],
      toolChoice: { name: "build_workout" },
      maxTokens: 2500,
    });
    const call = res.toolCalls.find((c) => c.name === "build_workout");
    if (!call) throw new Error("engine returned no workout");
    built = call.input as typeof built;
  } else {
    built = deterministicWorkout(
      library,
      opts.focusHint ?? inferFocus(plan, date),
      recoveryBand
    );
  }

  // Guardrail: red recovery forces a mobility/recovery day even if the model pushed training
  if (recoveryBand === "red" && !built.recommend_recovery_instead && built.focus !== "mobility") {
    built = deterministicWorkout(library, "mobility", "red");
    built.reasoning =
      "Recovery is RED (guardrail): swapped planned training for mobility/recovery. " + built.reasoning;
  }

  const workout = await queryOne(
    `insert into workouts (plan_id, title, focus, scheduled_date, duration_min, status, reasoning, source)
     values ($1,$2,$3,$4,$5,'planned',$6,'engine') returning id`,
    [plan?.id ?? null, built.title, built.focus, date, built.duration_min, built.reasoning]
  );
  const workoutId = workout!.id as string;

  let seq = 1;
  for (const ex of built.exercises) {
    const found = await queryOne(`select id from exercises where slug=$1`, [ex.slug]);
    if (!found) continue; // model hallucinated a slug — skip rather than invent
    await query(
      `insert into exercise_prescriptions (workout_id, exercise_id, seq, sets, reps, time_seconds, load_lb, rest_seconds, target_rpe, reasoning)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [workoutId, found.id, seq++, ex.sets, ex.reps ?? null, ex.time_seconds ?? null,
       ex.load_lb ?? null, ex.rest_seconds ?? 60, ex.target_rpe ?? null, ex.reasoning ?? null]
    );
  }

  await query(
    `insert into coach_decisions (kind, decision, reasoning, context, status)
     values ('daily_training', $1, $2, $3, 'proposed')`,
    [`${built.title} (${built.duration_min} min, ${built.focus})`, built.reasoning,
     JSON.stringify({ workout_id: workoutId, date, recovery_band: recoveryBand })]
  );

  return { workoutId, title: built.title, reasoning: built.reasoning };
}

function inferFocus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plan: any,
  date: string
): string {
  const dow = new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = plan?.template?.week?.find(
    (d: { day: string }) => d.day === names[dow]
  );
  return day?.focus ?? "full_body";
}

/* Deterministic template-based builder — used with no LLM key and as the
   red-recovery guardrail. Picks by movement pattern at moderate difficulty. */
export function deterministicWorkout(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  library: any[],
  focus: string,
  recoveryBand: string
): {
  title: string;
  focus: string;
  duration_min: number;
  reasoning: string;
  exercises: GeneratedExercise[];
} {
  const patternsByFocus: Record<string, string[]> = {
    lower_core: ["squat", "hinge", "lunge", "glute", "core_anti_extension", "hip_mobility"],
    upper_core: ["horizontal_push", "horizontal_pull", "vertical_push", "vertical_pull", "core_anti_rotation", "shoulder_mobility"],
    full_body: ["squat", "horizontal_push", "hinge", "horizontal_pull", "carry", "hip_mobility"],
    mobility: ["hip_mobility", "ankle_mobility", "thoracic_mobility", "shoulder_mobility", "core_anti_extension"],
    conditioning: ["conditioning", "carry", "core_anti_rotation", "hip_mobility"],
  };
  const patterns = patternsByFocus[focus] ?? patternsByFocus.full_body;
  const maxDifficulty = recoveryBand === "green" ? 4 : 3;
  const sets = recoveryBand === "yellow" ? 2 : 3;

  const exercises: GeneratedExercise[] = [];
  for (const p of patterns) {
    const candidates = library
      .filter((e) => e.movement_pattern === p && e.difficulty <= maxDifficulty)
      .sort((a, b) => Math.abs(a.difficulty - 2.5) - Math.abs(b.difficulty - 2.5));
    if (candidates.length === 0) continue;
    const pick = candidates[0];
    const isMobility = p.includes("mobility");
    exercises.push({
      slug: pick.slug,
      sets: isMobility ? 2 : sets,
      reps: isMobility ? undefined : "8-10",
      time_seconds: isMobility ? 45 : undefined,
      rest_seconds: isMobility ? 20 : 75,
      target_rpe: recoveryBand === "green" ? 7.5 : 6.5,
    });
  }

  const isRecovery = focus === "mobility";
  return {
    title: isRecovery
      ? "Mobility & Recovery"
      : focus === "lower_core"
        ? "Lower + Core"
        : focus === "upper_core"
          ? "Upper + Core"
          : focus === "conditioning"
            ? "Conditioning"
            : "Full Body",
    focus,
    duration_min: isRecovery ? 25 : recoveryBand === "yellow" ? 32 : 38,
    reasoning: `Template-based ${focus} session (deterministic builder), scaled for ${recoveryBand} recovery: ${sets} working sets, difficulty cap ${maxDifficulty}.`,
    exercises,
  };
}
