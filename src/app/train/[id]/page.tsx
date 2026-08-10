"use client";

/* WORKOUT MODE — execution screen. Current exercise, cues, previous
   performance + suggested load, one-tap set logging with PR detection,
   rest timer, and hands-free voice: toggle listening and say
   "<wake word>, nine reps at thirty-five" — no tapping mid-set. */

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, useFetch, useWakeWord } from "@/lib/client";
import InputBar, { Submission } from "@/components/InputBar";
import { MicIcon, PlayIcon, TrophyIcon } from "@/components/icons";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function WorkoutModePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, reload } = useFetch<Any>(`/api/workouts/${id}`);
  const { data: profileData } = useFetch<Any>("/api/profile");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [loggedSets, setLoggedSets] = useState<Record<string, number>>({});
  const [rest, setRest] = useState<number | null>(null);
  const [voiceReply, setVoiceReply] = useState<string | null>(null);
  const [pr, setPr] = useState<Any>(null);
  const [finishing, setFinishing] = useState(false);
  const [sessionRpe, setSessionRpe] = useState(7);

  const wakeWord: string =
    profileData?.profile?.preferences?.coach_name ?? "Coach";

  const w = data?.workout;
  const rx: Any[] = w?.prescriptions ?? [];
  const current = rx[idx];
  const prevPerf = (data?.previous_performances ?? []).find(
    (p: Any) => p.exercise_id === current?.exercise?.id
  );

  useEffect(() => {
    if (rest === null || rest <= 0) return;
    const t = setTimeout(() => setRest((r) => (r !== null ? r - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [rest]);

  const start = async () => {
    const res = await api<Any>("/api/sessions", { method: "POST", json: { workout_id: id } });
    setSessionId(res.session.id);
  };

  const editRef = useRef<{ reps?: number; load?: number; rpe?: number }>({});
  const sessionRef = useRef<string | null>(null);
  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  const logSet = async (rpe?: number) => {
    if (!current) return;
    const setNum = (loggedSets[current.id] ?? 0) + 1;
    const res = await api<Any>("/api/performances", {
      method: "POST",
      json: {
        session_id: sessionRef.current ?? undefined,
        prescription_id: current.id,
        exercise_id: current.exercise.id,
        set_number: setNum,
        reps: editRef.current.reps ?? parseReps(current.reps),
        load_lb: editRef.current.load ?? current.load_lb ?? undefined,
        time_seconds: current.time_seconds ?? undefined,
        rpe: rpe ?? editRef.current.rpe,
      },
    });
    if (res.pr?.isPr) {
      setPr(res.pr);
      setTimeout(() => setPr(null), 6000);
    }
    setLoggedSets((s) => ({ ...s, [current.id]: setNum }));
    if (setNum >= (current.sets ?? 3) && idx < rx.length - 1) {
      setIdx(idx + 1);
    }
    setRest(current.rest_seconds ?? 60);
  };

  const finish = async () => {
    if (sessionId) {
      await api(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        json: { session_rpe: sessionRpe, completed: true },
      });
    } else {
      await api(`/api/workouts/${id}`, { method: "PATCH", json: { status: "completed" } });
    }
    router.push("/train");
  };

  const voiceNote = async (s: Submission) => {
    if (s.imageBase64) {
      const res = await api<Any>("/api/chat", {
        method: "POST",
        json: {
          text: s.text || "Look at this — what is it / what should I do with it?",
          imageBase64: s.imageBase64,
          imageMediaType: s.imageMediaType,
          modality: "photo",
        },
      });
      setVoiceReply(res.reply);
      reload();
      return;
    }
    if (!s.text) return;
    const res = await api<Any>("/api/voice-note", {
      method: "POST",
      json: { text: s.text, session_id: sessionRef.current ?? undefined },
    });
    setVoiceReply(res.reply);
    reload();
  };

  const handsFree = useWakeWord(wakeWord, (command) => {
    voiceNote({ text: command, modality: "voice" });
  });

  if (!w) return <main className="p-6 text-muted">Loading…</main>;

  const done = loggedSets[current?.id] ?? 0;

  return (
    <main className="px-4 pt-[calc(env(safe-area-inset-top)+1rem)] space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{w.title}</h1>
          <p className="text-muted text-xs">
            {w.duration_min} min · exercise {Math.min(idx + 1, rx.length)} of {rx.length}
          </p>
        </div>
        {!sessionId && w.status !== "completed" ? (
          <button onClick={start} className="rounded-full bg-accent text-black text-sm font-bold px-4 py-2">
            Start
          </button>
        ) : (
          <button onClick={() => setFinishing(true)} className="rounded-full border border-line bg-surface text-sm font-semibold px-4 py-2">
            Finish
          </button>
        )}
      </header>

      {/* hands-free toggle */}
      {handsFree.supported && (
        <button
          onClick={() => handsFree.setEnabled(!handsFree.enabled)}
          className={`w-full card px-4 py-3 flex items-center gap-3 text-sm text-left transition-colors ${
            handsFree.enabled ? "border-accent/50" : ""
          }`}
        >
          <span className={handsFree.enabled ? "text-accent" : "text-muted"}>
            <MicIcon size={18} />
          </span>
          {handsFree.enabled ? (
            <span className={handsFree.armed ? "text-accent" : ""}>
              {handsFree.armed
                ? "Listening — go ahead…"
                : <>Hands-free on — say <b>&quot;{wakeWord}, …&quot;</b> anytime</>}
            </span>
          ) : (
            <span className="text-muted">Enable hands-free voice (&quot;{wakeWord}, nine reps at 35&quot;)</span>
          )}
        </button>
      )}

      {pr && (
        <div className="card p-3.5 border-accent bg-accent/10 flex items-center gap-3">
          <span className="text-accent"><TrophyIcon size={22} /></span>
          <div>
            <p className="text-sm font-bold text-accent">New PR!</p>
            <p className="text-xs text-ink/85">{pr.note}</p>
          </div>
        </div>
      )}

      {rest !== null && rest > 0 && (
        <div className="card p-3 border-info/40 flex items-center justify-between">
          <span className="text-sm text-muted">Rest</span>
          <span className="text-2xl font-bold tabular-nums">{rest}s</span>
          <button className="text-xs text-muted" onClick={() => setRest(null)}>skip</button>
        </div>
      )}

      {finishing ? (
        <section className="card p-5 space-y-4">
          <h2 className="font-semibold">How hard was the session?</h2>
          <div className="flex items-center gap-3">
            <input
              type="range" min={1} max={10} step={0.5} value={sessionRpe}
              onChange={(e) => setSessionRpe(Number(e.target.value))}
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="text-xl font-bold tabular-nums w-10 text-right">{sessionRpe}</span>
          </div>
          <button onClick={finish} className="w-full rounded-2xl bg-accent text-black font-bold py-3">
            Complete workout
          </button>
        </section>
      ) : current ? (
        <>
          <section className="card p-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-2xl font-bold leading-tight">{current.exercise.name}</h2>
                <p className="text-muted text-sm mt-0.5">
                  {current.sets} × {current.reps ?? (current.time_seconds ? `${current.time_seconds}s` : "—")}
                  {current.load_lb ? ` @ ${current.load_lb} lb` : ""}
                  {current.target_rpe ? ` · RPE ${current.target_rpe}` : ""}
                </p>
              </div>
              <div className="h-14 w-14 rounded-xl bg-surface2 border border-line grid place-items-center text-muted shrink-0">
                <PlayIcon size={24} />
              </div>
            </div>

            {prevPerf && (
              <div className="text-xs space-y-0.5">
                <p className="text-info">
                  Last time: {prevPerf.reps ?? "—"} reps
                  {prevPerf.load_lb ? ` @ ${prevPerf.load_lb} lb` : ""}
                  {prevPerf.rpe ? ` · RPE ${prevPerf.rpe}` : ""}
                </p>
                {prevPerf.suggestion && (
                  <p className="text-accent">{prevPerf.suggestion.rationale}</p>
                )}
              </div>
            )}

            {(current.exercise.form_cues ?? []).length > 0 && (
              <ul className="text-sm text-ink/80 space-y-1">
                {current.exercise.form_cues.slice(0, 3).map((c: string) => (
                  <li key={c} className="flex gap-2"><span className="text-accent">•</span>{c}</li>
                ))}
              </ul>
            )}
            {current.reasoning && (
              <p className="text-xs text-muted italic">{current.reasoning}</p>
            )}

            <div className="grid grid-cols-3 gap-2 pt-1">
              <QuickEdit label="Reps" defaultValue={parseReps(current.reps)} onChange={(v) => (editRef.current.reps = v)} />
              <QuickEdit label="Load lb" defaultValue={current.load_lb ?? prevPerf?.suggestion?.loadLb ?? undefined} onChange={(v) => (editRef.current.load = v)} />
              <QuickEdit label="RPE" defaultValue={undefined} onChange={(v) => (editRef.current.rpe = v)} />
            </div>

            <button
              onClick={() => logSet()}
              className="w-full rounded-2xl bg-accent text-black font-bold py-3.5 text-lg active:scale-[0.98]"
            >
              Log set {done + 1} of {current.sets}
            </button>
          </section>

          <div className="flex items-center justify-between text-sm">
            <button className="text-muted" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
              ← Prev
            </button>
            <span className="text-muted text-xs tracking-widest">
              {rx.map((p: Any, i: number) => (
                <span key={p.id} className={i === idx ? "text-accent" : ""}>●</span>
              ))}
            </span>
            <button className="text-muted" disabled={idx >= rx.length - 1} onClick={() => setIdx(idx + 1)}>
              Next →
            </button>
          </div>

          {rx[idx + 1] && (
            <p className="text-xs text-muted text-center">
              Next: {rx[idx + 1].exercise.name}
            </p>
          )}
        </>
      ) : (
        <p className="text-muted">No exercises prescribed.</p>
      )}

      {voiceReply && (
        <div className="card p-3 text-sm text-accent border-accent/30">{voiceReply}</div>
      )}

      <div className="sticky bottom-24 pt-1">
        <InputBar onSubmit={voiceNote} placeholder='"Used 35s… only got 7… RPE 9…"' />
      </div>
    </main>
  );
}

function QuickEdit({ label, defaultValue, onChange }: {
  label: string; defaultValue?: number; onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        defaultValue={defaultValue}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-center font-semibold outline-none focus:border-accent"
      />
    </label>
  );
}

function parseReps(reps: string | null): number | undefined {
  if (!reps) return undefined;
  const m = /^(\d+)/.exec(reps);
  return m ? Number(m[1]) : undefined;
}
