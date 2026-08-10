/* Strength progression & PR engine (Ladder-style).
   Deterministic: estimated 1RM via Epley from logged sets, all-time bests,
   PR detection at log time, and a suggested next load when recent sets came
   in under the target RPE. */

import { query, queryOne } from "./db";

/** Epley estimated 1RM. Only meaningful for roughly 1-12 rep sets. */
export function epley1Rm(loadLb: number, reps: number): number {
  if (reps <= 0 || loadLb <= 0) return 0;
  if (reps === 1) return loadLb;
  return +(loadLb * (1 + Math.min(reps, 12) / 30)).toFixed(1);
}

export interface PrCheck {
  isPr: boolean;
  kind: "e1rm" | "load" | "reps_at_load" | null;
  e1rm: number;
  previousBestE1rm: number | null;
  note: string | null;
}

/** Compare a just-logged set against all prior history for the exercise. */
export function evaluatePr(
  current: { loadLb: number | null; reps: number | null },
  history: { loadLb: number | null; reps: number | null }[]
): PrCheck {
  const load = current.loadLb ?? 0;
  const reps = current.reps ?? 0;
  const e1rm = epley1Rm(load, reps);

  const withLoad = history.filter((h) => (h.loadLb ?? 0) > 0 && (h.reps ?? 0) > 0);
  if (load <= 0 || reps <= 0) {
    return { isPr: false, kind: null, e1rm, previousBestE1rm: null, note: null };
  }
  if (withLoad.length === 0) {
    // first loaded set ever: baseline, not a PR celebration
    return { isPr: false, kind: null, e1rm, previousBestE1rm: null, note: "baseline set" };
  }

  const bestE1rm = Math.max(...withLoad.map((h) => epley1Rm(h.loadLb!, h.reps!)));
  const bestLoad = Math.max(...withLoad.map((h) => h.loadLb!));
  const bestRepsAtLoad = Math.max(
    0,
    ...withLoad.filter((h) => h.loadLb! >= load).map((h) => h.reps!)
  );

  if (e1rm > bestE1rm) {
    return {
      isPr: true, kind: "e1rm", e1rm, previousBestE1rm: bestE1rm,
      note: `Estimated 1RM up from ${bestE1rm} to ${e1rm} lb`,
    };
  }
  if (load > bestLoad) {
    return {
      isPr: true, kind: "load", e1rm, previousBestE1rm: bestE1rm,
      note: `Heaviest set yet at ${load} lb`,
    };
  }
  if (bestRepsAtLoad > 0 && reps > bestRepsAtLoad) {
    return {
      isPr: true, kind: "reps_at_load", e1rm, previousBestE1rm: bestE1rm,
      note: `Most reps at ${load} lb (${reps}, previous ${bestRepsAtLoad})`,
    };
  }
  return { isPr: false, kind: null, e1rm, previousBestE1rm: bestE1rm, note: null };
}

/** Suggested next load: last top set at/below target RPE with full reps → nudge up. */
export function suggestNextLoad(
  last: { loadLb: number | null; reps: number | null; rpe: number | null },
  targetRpe = 7.5
): { loadLb: number; rationale: string } | null {
  if (!last.loadLb || !last.reps) return null;
  const increment = last.loadLb >= 70 ? 5 : 2.5;
  if (last.rpe != null && last.rpe <= targetRpe - 1 && last.reps >= 8) {
    return {
      loadLb: last.loadLb + increment,
      rationale: `Last time ${last.reps} reps @ ${last.loadLb} lb felt RPE ${last.rpe} — progress to ${last.loadLb + increment} lb`,
    };
  }
  if (last.rpe != null && last.rpe >= 9) {
    return {
      loadLb: Math.max(0, last.loadLb - increment),
      rationale: `Last set was RPE ${last.rpe} — back off to ${last.loadLb - increment} lb and own the reps`,
    };
  }
  return { loadLb: last.loadLb, rationale: `Repeat ${last.loadLb} lb and aim for one more rep` };
}

/** PR check against DB history (excluding the given performance id). */
export async function checkPrForPerformance(
  exerciseId: string,
  performanceId: string,
  loadLb: number | null,
  reps: number | null
): Promise<PrCheck> {
  const history = await query(
    `select load_lb as "loadLb", reps from exercise_performances
     where exercise_id = $1 and id <> $2 and load_lb is not null and reps is not null`,
    [exerciseId, performanceId]
  );
  return evaluatePr({ loadLb, reps }, history);
}

/** Per-exercise strength overview for the Progress screen. */
export async function strengthOverview() {
  const rows = await query(
    `select e.id, e.name, e.movement_pattern,
            p.recorded_at::date::text as date, p.load_lb, p.reps, p.rpe
     from exercise_performances p
     join exercises e on e.id = p.exercise_id
     where p.load_lb is not null and p.reps is not null and p.reps > 0
       and e.movement_pattern not like '%mobility%'
     order by e.name, p.recorded_at`
  );

  const byExercise = new Map<string, {
    name: string;
    pattern: string;
    series: { date: string; e1rm: number }[];
    bestE1rm: number;
    latest: { date: string; load_lb: number; reps: number; rpe: number | null };
    sets: number;
  }>();

  for (const r of rows) {
    const e1rm = epley1Rm(Number(r.load_lb), Number(r.reps));
    let entry = byExercise.get(r.id);
    if (!entry) {
      entry = { name: r.name, pattern: r.movement_pattern, series: [], bestE1rm: 0, latest: r, sets: 0 };
      byExercise.set(r.id, entry);
    }
    entry.sets++;
    entry.bestE1rm = Math.max(entry.bestE1rm, e1rm);
    entry.latest = { date: r.date, load_lb: Number(r.load_lb), reps: Number(r.reps), rpe: r.rpe };
    const day = entry.series.find((s) => s.date === r.date);
    if (day) day.e1rm = Math.max(day.e1rm, e1rm);
    else entry.series.push({ date: r.date, e1rm });
  }

  const suggestion = async (exerciseId: string) => {
    const last = await queryOne(
      `select load_lb as "loadLb", reps, rpe from exercise_performances
       where exercise_id=$1 and load_lb is not null
       order by recorded_at desc limit 1`,
      [exerciseId]
    );
    return last ? suggestNextLoad(last) : null;
  };

  const out = [];
  for (const [id, e] of byExercise) {
    const first = e.series[0]?.e1rm ?? 0;
    const latest = e.series[e.series.length - 1]?.e1rm ?? 0;
    out.push({
      exercise_id: id,
      name: e.name,
      pattern: e.pattern,
      sets_logged: e.sets,
      best_e1rm: e.bestE1rm,
      latest_e1rm: latest,
      change_e1rm: +(latest - first).toFixed(1),
      series: e.series,
      latest_set: e.latest,
      next_load: await suggestion(id),
    });
  }
  return out.sort((a, b) => b.sets_logged - a.sets_logged);
}
