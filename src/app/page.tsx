"use client";

/* TODAY — home screen. Recovery, vitals, training, nutrition, next action,
   next meal, and the global coach input. */

import { useState } from "react";
import Link from "next/link";
import { api, useFetch } from "@/lib/client";
import InputBar, { Submission } from "@/components/InputBar";
import { SunIcon, BellIcon } from "@/components/icons";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function TodayPage() {
  const { data, reload } = useFetch<Any>("/api/today");
  const { data: nextMeal } = useFetch<Any>("/api/next-meal");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [morningBusy, setMorningBusy] = useState(false);

  const submit = async (s: Submission) => {
    setBusy(true);
    setReply(null);
    try {
      const res = await api<Any>("/api/chat", { method: "POST", json: s });
      setReply(res.reply);
      reload();
    } catch (e) {
      setReply(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const runMorning = async () => {
    setMorningBusy(true);
    try {
      const res = await api<Any>("/api/morning", { method: "POST" });
      setReply(res.brief);
      reload();
    } catch (e) {
      setReply(`⚠️ ${(e as Error).message}`);
    } finally {
      setMorningBusy(false);
    }
  };

  const m = data?.measurements ?? {};
  const rec = data?.recovery;
  const n = data?.nutrition;
  const kcalPct = n ? Math.min(100, (n.consumed.kcal / n.target.kcal) * 100) : 0;
  const protPct = n ? Math.min(100, (n.consumed.protein_g / n.target.protein_g) * 100) : 0;

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();

  return (
    <main className="px-4 pt-[calc(env(safe-area-inset-top)+1rem)] space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{greeting}</h1>
          <p className="text-muted text-sm">{data?.date ?? ""}</p>
        </div>
        <button
          onClick={runMorning}
          disabled={morningBusy}
          className="text-xs font-semibold rounded-full border border-line bg-surface px-3 py-2 text-muted active:scale-95 flex items-center gap-1.5"
        >
          <SunIcon size={14} />
          {morningBusy ? "Thinking…" : "Morning brief"}
        </button>
      </header>

      {(data?.notifications ?? []).map((notif: Any) => (
        <div key={notif.id} className="card p-3.5 border-amber/40 flex items-start gap-3">
          <span className="text-amber mt-0.5"><BellIcon size={17} /></span>
          <div className="flex-1">
            <p className="text-sm font-semibold">{notif.title}</p>
            {notif.body && <p className="text-xs text-muted mt-0.5">{notif.body}</p>}
          </div>
          <button
            className="text-muted text-xs"
            onClick={async () => {
              await api("/api/notifications", { method: "PATCH", json: { id: notif.id } });
              reload();
            }}
          >
            ✕
          </button>
        </div>
      ))}

      {/* Recovery + vitals */}
      <section className="card p-4">
        <div className="flex items-center gap-4">
          <RecoveryRing score={rec?.score ?? null} band={rec?.band ?? null} />
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 flex-1 text-sm">
            <Vital label="Weight" value={m.weight ? `${m.weight.value}` : "—"} unit="lb" />
            <Vital label="Waist" value={m.waist ? `${m.waist.value}` : "—"} unit="in" />
            <Vital label="Sleep" value={data?.sleep_min ? fmtSleep(data.sleep_min) : "—"} unit="" />
            <Vital label="RHR" value={data?.rhr ?? "—"} unit={data?.rhr ? "bpm" : ""} />
            <Vital label="HRV" value={data?.hrv ?? "—"} unit={data?.hrv ? "ms" : ""} />
            <Vital
              label="Energy"
              value={data?.daily_state?.energy ?? "—"}
              unit={data?.daily_state?.energy ? "/10" : ""}
            />
          </div>
        </div>
      </section>

      {/* Training */}
      <section className="card p-4">
        <SectionTitle>Today&apos;s training</SectionTitle>
        {data?.workout ? (
          <Link href={`/train/${data.workout.id}`} className="block mt-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-lg">{data.workout.title}</p>
                <p className="text-muted text-sm">
                  {data.workout.duration_min} min · {data.workout.exercise_count} exercises
                  {data.workout.scheduled_start &&
                    ` · ${new Date(data.workout.scheduled_start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                </p>
              </div>
              <StatusPill status={data.workout.status} />
            </div>
          </Link>
        ) : (
          <div className="mt-2 flex items-center justify-between">
            <p className="text-muted text-sm">No workout yet.</p>
            <Link href="/train" className="text-accent text-sm font-semibold">
              Build one →
            </Link>
          </div>
        )}
      </section>

      {/* Nutrition */}
      <section className="card p-4 space-y-3">
        <SectionTitle>Nutrition</SectionTitle>
        {n && (
          <>
            <MacroBar label="Calories" now={n.consumed.kcal} target={n.target.kcal} pct={kcalPct} unit="kcal" color="var(--accent)" />
            <MacroBar label="Protein" now={n.consumed.protein_g} target={n.target.protein_g} pct={protPct} unit="g" color="var(--blue)" />
            <p className="text-xs text-muted">
              Remaining: {Math.max(0, Math.round(n.remaining.kcal))} kcal ·{" "}
              {Math.max(0, Math.round(n.remaining.protein_g))}g protein
              {n.target.eating_window_start &&
                ` · window ${fmtTime(n.target.eating_window_start)}–${fmtTime(n.target.eating_window_end)}`}
            </p>
          </>
        )}
      </section>

      {/* Next action + next meal */}
      {data?.focus && (
        <section className="card p-4 border-accent/30">
          <SectionTitle>Next action</SectionTitle>
          <p className="mt-1.5 text-[15px] leading-snug">{data.focus}</p>
        </section>
      )}

      {nextMeal && (
        <section className="card p-4">
          <SectionTitle>Next meal</SectionTitle>
          <p className="mt-1.5 text-[15px] leading-snug text-ink/90">{nextMeal.recommendation}</p>
        </section>
      )}

      {reply && (
        <section className="card p-4 bg-surface2 border-accent/20">
          <SectionTitle>Coach</SectionTitle>
          <p className="mt-1.5 text-[15px] leading-relaxed whitespace-pre-wrap">{reply}</p>
        </section>
      )}

      <div className="sticky bottom-24 pt-1">
        <InputBar onSubmit={submit} busy={busy} />
      </div>
    </main>
  );
}

function RecoveryRing({ score, band }: { score: number | null; band: string | null }) {
  const color =
    band === "green" ? "var(--accent)" : band === "yellow" ? "var(--amber)" : band === "red" ? "var(--red)" : "var(--border)";
  const pct = score ?? 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle
          cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-xl font-bold leading-none">{score ?? "—"}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted mt-0.5">{band ?? "recovery"}</p>
        </div>
      </div>
    </div>
  );
}

function Vital({ label, value, unit }: { label: string; value: string | number; unit: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted text-xs">{label}</span>
      <span className="font-semibold tabular-nums">
        {value}
        {unit && <span className="text-muted text-xs font-normal"> {unit}</span>}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>;
}

function MacroBar({ label, now, target, pct, unit, color }: {
  label: string; now: number; target: number; pct: number; unit: string; color: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted">{label}</span>
        <span className="font-semibold tabular-nums">
          {Math.round(now)} <span className="text-muted font-normal">/ {target} {unit}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface2 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "text-accent border-accent/40",
    in_progress: "text-amber border-amber/40",
    scheduled: "text-info border-info/40",
    planned: "text-muted border-line",
    skipped: "text-danger border-danger/40",
  };
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-wide border rounded-full px-2.5 py-1 ${map[status] ?? "text-muted border-line"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function fmtSleep(min: number) {
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
}
function fmtTime(t: string) {
  const [h, mm] = t.split(":");
  const hour = Number(h);
  return `${hour % 12 || 12}${mm !== "00" ? ":" + mm : ""}${hour >= 12 ? "pm" : "am"}`;
}
