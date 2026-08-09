/* Structured-state extraction.
   After every coach interaction the user's message is analyzed and meaningful
   facts are written back into canonical tables. The chat transcript is NEVER
   the source of truth — this module is what makes that real.

   Uncertain medical hypotheses are stored as status='hypothesis' with
   confidence, never silently converted into facts. */

import { getLlm, LlmTool } from "./llm";
import { query, queryOne, todayLocal } from "./db";

export interface ExtractedRecord {
  table: string;
  id: string;
  summary: string;
}

const EXTRACT_TOOL: LlmTool = {
  name: "record_structured_updates",
  description:
    "Record structured health/fitness facts stated by the user so they persist in the canonical database. Only record facts the user actually stated or clearly implied. Do not invent values.",
  inputSchema: {
    type: "object",
    properties: {
      measurements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              description:
                "weight | waist | body_fat_pct | chest | hips | arm | thigh | neck",
            },
            value: { type: "number" },
            unit: { type: "string", description: "lb | kg | in | cm | pct" },
            location: { type: "string", description: "e.g. navel for waist" },
            state: { type: "string", description: "relaxed | flexed | fasted" },
            timing: { type: "string", description: "morning | evening" },
            confidence: { type: "number" },
          },
          required: ["kind", "value", "unit"],
        },
      },
      mobility_findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            area: { type: "string", description: "hip | ankle | shoulder | thoracic | hamstring | other" },
            side: { type: "string", description: "left | right | bilateral" },
            movement: { type: "string", description: "the movement or test, e.g. 'pigeon pose'" },
            finding: { type: "string" },
            severity: { type: "integer", description: "1 (minimal) - 5 (severe restriction)" },
            status: { type: "string", description: "observation | hypothesis | confirmed" },
            confidence: { type: "number" },
          },
          required: ["area", "movement", "finding"],
        },
      },
      symptoms: {
        type: "array",
        items: {
          type: "object",
          properties: {
            body_part: { type: "string" },
            side: { type: "string" },
            kind: { type: "string", description: "pain | pinch | tightness | ache | numbness | fatigue" },
            description: { type: "string" },
            severity: { type: "integer", description: "1-10" },
            during_exercise: { type: "string", description: "exercise name if it occurred during one" },
            confidence: { type: "number" },
          },
          required: ["body_part", "description"],
        },
      },
      exercise_performances: {
        type: "array",
        items: {
          type: "object",
          properties: {
            exercise: { type: "string", description: "exercise name as stated" },
            set_number: { type: "integer" },
            reps: { type: "integer" },
            load_lb: { type: "number" },
            time_seconds: { type: "integer" },
            rpe: { type: "number" },
            notes: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["exercise"],
        },
      },
      daily_state: {
        type: "object",
        description: "Subjective state for today, only fields the user mentioned",
        properties: {
          energy: { type: "integer", description: "1-10" },
          hunger: { type: "integer" },
          soreness: { type: "integer" },
          stress: { type: "integer" },
          mood: { type: "string" },
          notes: { type: "string" },
        },
      },
      observations: {
        type: "array",
        description:
          "Coaching-relevant patterns, preferences, constraints or context worth remembering (e.g. 'travels next Tuesday', 'dislikes salmon', 'meeting moved to 8am'). NOT for data covered by other arrays.",
        items: {
          type: "object",
          properties: {
            category: { type: "string", description: "training | nutrition | recovery | mobility | behavior | schedule | preference" },
            content: { type: "string" },
            status: { type: "string", description: "observation | hypothesis | confirmed" },
            confidence: { type: "number" },
          },
          required: ["category", "content"],
        },
      },
    },
  },
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Normalize weight to lb, lengths to inches. */
function normalizeMeasurement(kind: string, value: number, unit: string) {
  const u = unit.toLowerCase();
  if (kind === "weight" && (u === "kg" || u === "kgs")) {
    return { value: +(value * 2.20462).toFixed(1), unit: "lb" };
  }
  if (u === "cm") return { value: +(value / 2.54).toFixed(2), unit: "in" };
  if (u === "lbs") return { value, unit: "lb" };
  if (u === "inches" || u === "inch") return { value, unit: "in" };
  return { value, unit };
}

export async function extractAndPersist(
  userMessage: string,
  opts: { source?: string; chatMessageId?: string; sessionId?: string } = {}
): Promise<ExtractedRecord[]> {
  const source = opts.source ?? "chat";
  const llm = getLlm();
  const res = await llm.complete({
    system: `You extract structured health data from a user's message to their fitness coach. Today is ${todayLocal()}. Call record_structured_updates with ONLY facts explicitly stated or clearly implied. If the message contains no persistable facts, call the tool with an empty object. Use confidence 0.9+ only for explicit numeric statements; use 'hypothesis' status for causal guesses (e.g. "my hip probably caused the knee pain" is a hypothesis, not a confirmed fact).`,
    messages: [{ role: "user", content: userMessage }],
    tools: [EXTRACT_TOOL],
    toolChoice: { name: "record_structured_updates" },
    maxTokens: 2048,
    temperature: 0,
  });

  const call = res.toolCalls.find((c) => c.name === "record_structured_updates");
  if (!call) return [];
  return persistExtracted(call.input, { source, chatMessageId: opts.chatMessageId, sessionId: opts.sessionId });
}

/** Persist an already-parsed extraction payload (also used by voice notes). */
export async function persistExtracted(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>,
  opts: { source: string; chatMessageId?: string; sessionId?: string }
): Promise<ExtractedRecord[]> {
  const created: ExtractedRecord[] = [];
  const provenance = JSON.stringify({
    chat_message_id: opts.chatMessageId ?? null,
    extracted_at: new Date().toISOString(),
  });

  for (const m of input.measurements ?? []) {
    if (num(m.value) === null) continue;
    const norm = normalizeMeasurement(m.kind, m.value, m.unit ?? "lb");
    const row = await queryOne(
      `insert into measurements (kind, value, unit, location, state, timing, source, confidence, provenance)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [m.kind, norm.value, norm.unit, m.location ?? null, m.state ?? null,
       m.timing ?? null, opts.source, m.confidence ?? 0.9, provenance]
    );
    created.push({
      table: "measurements",
      id: row!.id,
      summary: `${m.kind} ${norm.value} ${norm.unit}${m.location ? ` @ ${m.location}` : ""}`,
    });
  }

  for (const f of input.mobility_findings ?? []) {
    // Update an existing unresolved finding for the same movement+side, else insert
    const existing = await queryOne(
      `select id from mobility_findings
       where lower(movement) = lower($1) and coalesce(side,'') = coalesce($2,'') and resolved_at is null`,
      [f.movement, f.side ?? null]
    );
    if (existing) {
      await query(
        `update mobility_findings set finding=$2, severity=coalesce($3,severity),
           status=coalesce($4,status), confidence=coalesce($5,confidence),
           last_observed=now(), notes = coalesce(notes,'') || E'\n' || $6
         where id=$1`,
        [existing.id, f.finding, f.severity ?? null, f.status ?? null,
         f.confidence ?? null, `[${todayLocal()}] ${f.finding}`]
      );
      created.push({ table: "mobility_findings", id: existing.id, summary: `updated: ${f.movement} (${f.side ?? "n/a"})` });
    } else {
      const row = await queryOne(
        `insert into mobility_findings (area, side, movement, finding, severity, status, confidence, source, provenance)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [f.area, f.side ?? null, f.movement, f.finding, f.severity ?? null,
         f.status ?? "observation", f.confidence ?? 0.7, opts.source, provenance]
      );
      created.push({ table: "mobility_findings", id: row!.id, summary: `${f.movement} (${f.side ?? "n/a"}): ${f.finding}` });
    }
  }

  for (const s of input.symptoms ?? []) {
    let exerciseId: string | null = null;
    if (s.during_exercise) {
      const ex = await queryOne(
        `select id from exercises where lower(name) like '%' || lower($1) || '%' limit 1`,
        [s.during_exercise]
      );
      exerciseId = ex?.id ?? null;
    }
    const row = await queryOne(
      `insert into symptoms (body_part, side, kind, description, severity, session_id, exercise_id, source, confidence, provenance)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [s.body_part, s.side ?? null, s.kind ?? "pain", s.description,
       s.severity ?? null, opts.sessionId ?? null, exerciseId, opts.source,
       s.confidence ?? 0.9, provenance]
    );
    created.push({ table: "symptoms", id: row!.id, summary: `${s.side ?? ""} ${s.body_part}: ${s.description}`.trim() });
  }

  for (const p of input.exercise_performances ?? []) {
    const ex = await queryOne(
      `select id, name from exercises
       where lower(name) like '%' || lower($1) || '%' or lower($1) like '%' || lower(name) || '%'
       order by length(name) limit 1`,
      [p.exercise]
    );
    if (!ex) {
      // Unknown exercise — keep as an observation instead of losing the data
      const row = await queryOne(
        `insert into coach_observations (category, content, status, confidence, source)
         values ('training', $1, 'observation', $2, $3) returning id`,
        [`Performance (unmatched exercise "${p.exercise}"): ${JSON.stringify(p)}`,
         p.confidence ?? 0.8, opts.source]
      );
      created.push({ table: "coach_observations", id: row!.id, summary: `unmatched exercise: ${p.exercise}` });
      continue;
    }
    const row = await queryOne(
      `insert into exercise_performances (session_id, exercise_id, set_number, reps, load_lb, time_seconds, rpe, notes, source, confidence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [opts.sessionId ?? null, ex.id, p.set_number ?? 1, p.reps ?? null,
       num(p.load_lb), p.time_seconds ?? null, num(p.rpe), p.notes ?? null,
       opts.source, p.confidence ?? 0.9]
    );
    created.push({
      table: "exercise_performances",
      id: row!.id,
      summary: `${ex.name}: ${p.reps ?? "?"} reps${p.load_lb ? ` @ ${p.load_lb} lb` : ""}${p.rpe ? ` RPE ${p.rpe}` : ""}`,
    });
  }

  const ds = input.daily_state;
  if (ds && Object.keys(ds).length > 0) {
    const row = await queryOne(
      `insert into daily_states (date, energy, hunger, soreness, stress, mood, notes, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (date) do update set
         energy = coalesce(excluded.energy, daily_states.energy),
         hunger = coalesce(excluded.hunger, daily_states.hunger),
         soreness = coalesce(excluded.soreness, daily_states.soreness),
         stress = coalesce(excluded.stress, daily_states.stress),
         mood = coalesce(excluded.mood, daily_states.mood),
         notes = case when excluded.notes is null then daily_states.notes
                      else coalesce(daily_states.notes || E'\n', '') || excluded.notes end,
         updated_at = now()
       returning id`,
      [todayLocal(), ds.energy ?? null, ds.hunger ?? null, ds.soreness ?? null,
       ds.stress ?? null, ds.mood ?? null, ds.notes ?? null, opts.source]
    );
    created.push({ table: "daily_states", id: row!.id, summary: "daily state updated" });
  }

  for (const o of input.observations ?? []) {
    const row = await queryOne(
      `insert into coach_observations (category, content, status, confidence, source)
       values ($1,$2,$3,$4,$5) returning id`,
      [o.category, o.content, o.status ?? "observation", o.confidence ?? 0.7, opts.source]
    );
    created.push({ table: "coach_observations", id: row!.id, summary: o.content });
  }

  return created;
}
