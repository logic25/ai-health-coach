"use client";

/* PROGRESS — experiment dashboard: trends, weekly reviews, scores,
   mobility, quick manual measurement entry, progress photos. */

import { useRef, useState } from "react";
import { api, useFetch, compressImage } from "@/lib/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function ProgressPage() {
  const { data, reload } = useFetch<Any>("/api/experiment");
  const { data: photos, reload: reloadPhotos } = useFetch<Any>("/api/photos");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addMeasurement = async (kind: string, unit: string, value: number) => {
    setBusy(true);
    try {
      await api("/api/measurements", { method: "POST", json: { kind, value, unit } });
      setMsg(`Saved ${kind}: ${value} ${unit}`);
      reload();
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const runReview = async () => {
    setBusy(true);
    try {
      await api("/api/review", { method: "POST", json: {} });
      setMsg("Weekly review computed.");
      reload();
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const stats = data?.workout_stats;

  return (
    <main className="px-4 pt-[calc(env(safe-area-inset-top)+1rem)] space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Progress</h1>
        <button
          onClick={runReview}
          disabled={busy}
          className="text-xs font-semibold rounded-full border border-line bg-surface px-3 py-2 text-muted"
        >
          📋 Run weekly review
        </button>
      </header>

      {msg && <p className="text-sm text-accent">{msg}</p>}

      {/* Quick measurement entry */}
      <section className="card p-4 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Log a measurement</h2>
        <QuickMeasure label="Weight (lb)" onSave={(v) => addMeasurement("weight", "lb", v)} busy={busy} />
        <QuickMeasure label="Waist (in, at navel, relaxed)" onSave={(v) => addMeasurement("waist", "in", v)} busy={busy} />
        <div>
          <input
            ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const img = await compressImage(f, 1400);
              await api("/api/photos", { method: "POST", json: { imageBase64: img.base64, mediaType: img.mediaType } });
              setMsg("Progress photo saved.");
              reloadPhotos();
              e.target.value = "";
            }}
          />
          <button onClick={() => fileRef.current?.click()} className="text-sm font-semibold text-info">
            📸 Add progress photo
          </button>
          {(photos?.photos ?? []).length > 0 && (
            <span className="text-xs text-muted ml-2">{photos.photos.length} saved</span>
          )}
        </div>
      </section>

      {/* Trends */}
      <section className="card p-4 space-y-4">
        <Trend title="Weight" unit="lb" points={data?.weight_trend ?? []} digits={1} />
        <Trend title="Waist" unit="in" points={data?.waist_trend ?? []} digits={2} />
      </section>

      {/* Adherence */}
      {stats && (
        <section className="card p-4 grid grid-cols-3 gap-3 text-center">
          <Stat label="Workouts done" value={`${stats.completed}/${stats.total || 0}`} />
          <Stat label="Avg steps" value={data.avg_steps_28d ?? "—"} />
          <Stat
            label="Avg sleep"
            value={data.avg_sleep_min_28d ? `${(data.avg_sleep_min_28d / 60).toFixed(1)}h` : "—"}
          />
          <Stat label="Meal corrections" value={data.meal_corrections} />
          <Stat label="Rescheduled" value={stats.rescheduled} />
          <Stat label="Skipped" value={stats.skipped} />
        </section>
      )}

      {/* Weekly reviews */}
      {(data?.weekly_reviews ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Weekly reviews</h2>
          {data.weekly_reviews.map((r: Any) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm">Week of {r.week_start}</p>
                <div className="flex gap-2 text-xs font-bold">
                  <span className="rounded-full bg-surface2 px-2 py-1">EXEC {r.execution_score}</span>
                  <span className="rounded-full bg-surface2 px-2 py-1">OUTCOME {r.outcome_score}</span>
                </div>
              </div>
              <p className="text-xs text-muted mt-2 leading-snug">{r.summary}</p>
              <p className="text-xs mt-1.5">
                <span className="text-muted">Decision: </span>
                <span className="text-accent font-semibold">{r.coach_decision?.replace("_", " ")}</span>
              </p>
            </div>
          ))}
        </section>
      )}

      {/* Mobility */}
      {(data?.mobility_findings ?? []).length > 0 && (
        <section className="card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Mobility watchlist</h2>
          <ul className="space-y-2">
            {data.mobility_findings.map((f: Any) => (
              <li key={`${f.movement}-${f.side}`} className="text-sm flex items-start justify-between gap-2">
                <span>
                  <b>{f.movement}</b> {f.side && <span className="text-muted">({f.side})</span>}
                  <span className="block text-xs text-muted">{f.finding}</span>
                </span>
                <span className={`text-xs font-bold shrink-0 ${f.severity >= 4 ? "text-danger" : f.severity >= 2 ? "text-amber" : "text-accent"}`}>
                  {f.severity ? `${f.severity}/5` : f.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Personal energy model */}
      {(data?.energy_model ?? []).length > 0 && (
        <section className="card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Your energy model</h2>
          {data.energy_model.map((e: Any) => (
            <p key={e.id} className="text-sm">
              Week {e.window_start}: ~{Math.round(e.avg_intake_kcal)} kcal/day →{" "}
              {e.weight_change_lb_wk > 0 ? "+" : ""}{e.weight_change_lb_wk} lb/wk · est. TDEE{" "}
              <b>{Math.round(e.estimated_tdee_kcal)}</b>{" "}
              <span className="text-muted text-xs">({Math.round(e.confidence * 100)}% conf)</span>
            </p>
          ))}
        </section>
      )}
    </main>
  );
}

function QuickMeasure({ label, onSave, busy }: { label: string; onSave: (v: number) => void; busy: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2">
      <input
        type="number" inputMode="decimal" placeholder={label} value={v}
        onChange={(e) => setV(e.target.value)}
        className="flex-1 rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-accent"
      />
      <button
        disabled={busy || !v}
        onClick={() => { onSave(Number(v)); setV(""); }}
        className="rounded-xl bg-accent text-black text-sm font-bold px-4 disabled:opacity-40"
      >
        Save
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
    </div>
  );
}

function Trend({ title, unit, points, digits }: {
  title: string; unit: string; points: { date: string; value: number }[]; digits: number;
}) {
  if (points.length === 0)
    return <p className="text-sm text-muted">{title}: no data yet.</p>;
  const values = points.map((p) => Number(p.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 320, h = 56;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const path = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / range) * (h - 8) - 4).toFixed(1)}`)
    .join(" ");
  const latest = values[values.length - 1];
  const first = values[0];
  const delta = latest - first;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm tabular-nums">
          <b>{latest.toFixed(digits)}</b> <span className="text-muted text-xs">{unit}</span>
          <span className={`ml-2 text-xs font-semibold ${delta <= 0 ? "text-accent" : "text-amber"}`}>
            {delta > 0 ? "+" : ""}{delta.toFixed(digits)}
          </span>
        </p>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14 mt-1">
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
        {points.length === 1 && <circle cx={0} cy={h / 2} r={3} fill="var(--accent)" />}
      </svg>
    </div>
  );
}
