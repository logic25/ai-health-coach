"use client";

/* TRAIN — today's session, generate/schedule actions, upcoming week. */

import { useState } from "react";
import Link from "next/link";
import { api, useFetch } from "@/lib/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function TrainPage() {
  const { data, reload } = useFetch<Any>("/api/workouts?upcoming=1");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const workouts: Any[] = data?.workouts ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const todays = workouts.filter((w) => w.scheduled_date === today);
  const upcoming = workouts.filter((w) => w.scheduled_date > today);

  return (
    <main className="px-4 pt-[calc(env(safe-area-inset-top)+1rem)] space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Train</h1>

      <div className="flex gap-2">
        <button
          onClick={() => act("gen", () => api("/api/workouts/generate", { method: "POST", json: {} }))}
          disabled={busy !== null}
          className="flex-1 rounded-2xl bg-accent text-black font-semibold py-3 text-sm active:scale-[0.98]"
        >
          {busy === "gen" ? "Building…" : "⚡ Build today's workout"}
        </button>
        <button
          onClick={() => act("week", () => api("/api/calendar/schedule-week", { method: "POST" }))}
          disabled={busy !== null}
          className="flex-1 rounded-2xl border border-line bg-surface font-semibold py-3 text-sm active:scale-[0.98]"
        >
          {busy === "week" ? "Planning…" : "🗓️ Plan the week"}
        </button>
      </div>

      {msg && <p className="text-sm text-amber">{msg}</p>}

      {todays.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Today</h2>
          {todays.map((w) => (
            <WorkoutCard key={w.id} w={w} onSchedule={() =>
              act("sched", () => api(`/api/workouts/${w.id}/schedule`, { method: "POST", json: {} }))
            } />
          ))}
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Upcoming</h2>
          {upcoming.map((w) => (
            <WorkoutCard key={w.id} w={w} />
          ))}
        </section>
      )}

      {workouts.length === 0 && (
        <p className="text-muted text-sm">
          No workouts yet — build today&apos;s session or plan the whole week.
        </p>
      )}
    </main>
  );
}

function WorkoutCard({ w, onSchedule }: { w: Any; onSchedule?: () => void }) {
  return (
    <div className="card p-4">
      <Link href={`/train/${w.id}`} className="block">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-lg">{w.title}</p>
            <p className="text-muted text-sm">
              {w.scheduled_date} · {w.duration_min} min · {(w.prescriptions ?? []).length} exercises
              {w.scheduled_start &&
                ` · ${new Date(w.scheduled_start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
            </p>
          </div>
          <span className="text-muted text-xl">›</span>
        </div>
        {w.reasoning && (
          <p className="text-xs text-muted mt-2 leading-snug line-clamp-2">{w.reasoning}</p>
        )}
      </Link>
      {onSchedule && !w.scheduled_start && w.status !== "completed" && (
        <button
          onClick={onSchedule}
          className="mt-3 text-xs font-semibold text-info border border-info/40 rounded-full px-3 py-1.5"
        >
          Add to calendar
        </button>
      )}
    </div>
  );
}
