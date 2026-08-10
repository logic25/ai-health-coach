"use client";

/* COACH — full conversation view. Transcript is persisted for UX, but every
   factual statement is extracted into structured state (shown as chips). */

import { useEffect, useRef, useState } from "react";
import { api, useFetch } from "@/lib/client";
import InputBar, { Submission } from "@/components/InputBar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function CoachPage() {
  const { data, reload } = useFetch<Any>("/api/chat");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages: Any[] = data?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pending]);

  const submit = async (s: Submission) => {
    setBusy(true);
    setPending(s.text ?? "📷 photo");
    try {
      await api("/api/chat", { method: "POST", json: s });
      reload();
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  return (
    <main className="px-4 pt-[calc(env(safe-area-inset-top)+1rem)] flex flex-col min-h-[calc(100dvh-6rem)]">
      <h1 className="text-2xl font-bold tracking-tight mb-3">Coach</h1>

      <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar pb-4">
        {messages.length === 0 && (
          <div className="card p-4 text-sm text-muted leading-relaxed">
            Ask anything — training, food, recovery, schedule. Facts you state
            (&quot;waist is 38.5&quot;, &quot;right shoulder pinched on press&quot;) are stored in your
            structured health record automatically.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-accent/15 border border-accent/25"
                  : "bg-surface border border-line"
              }`}
            >
              {m.content}
              {(m.extracted ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.extracted.map((e: Any, i: number) => (
                    <span key={i} className="text-[10px] rounded-full bg-surface2 border border-line px-2 py-0.5 text-muted">
                      <span className="text-accent">●</span> saved · {e.summary}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] bg-accent/15 border border-accent/25">
                {pending}
              </div>
            </div>
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-2.5 bg-surface border border-line text-muted animate-pulse-soft">
                thinking…
              </div>
            </div>
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-24 pt-2 bg-bg">
        <InputBar onSubmit={submit} busy={busy} />
      </div>
    </main>
  );
}
