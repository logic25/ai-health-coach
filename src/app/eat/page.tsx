"use client";

/* EAT — running macros, meal log, low-friction logging (text/voice/photo),
   pre-eating advice ("how much of this should I eat?"), and corrections. */

import { useState } from "react";
import { api, useFetch } from "@/lib/client";
import InputBar, { Submission } from "@/components/InputBar";
import { CartIcon } from "@/components/icons";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function EatPage() {
  const { data: mealsData, reload: reloadMeals } = useFetch<Any>("/api/meals");
  const { data: macros, reload: reloadMacros } = useFetch<Any>("/api/next-meal");
  const [mode, setMode] = useState<"log" | "advise">("log");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Any>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [shoppingList, setShoppingList] = useState<Any>(null);

  const reload = () => { reloadMeals(); reloadMacros(); };

  const submit = async (s: Submission) => {
    setBusy(true);
    setResult(null);
    try {
      if (mode === "advise") {
        const res = await api<Any>("/api/meals/advise", {
          method: "POST",
          json: { text: s.text, imageBase64: s.imageBase64, imageMediaType: s.imageMediaType },
        });
        setResult({ kind: "advice", ...res });
      } else {
        const res = await api<Any>("/api/meals/estimate", {
          method: "POST",
          json: {
            text: s.text, imageBase64: s.imageBase64, imageMediaType: s.imageMediaType,
            source: s.modality === "photo" ? "photo" : s.modality,
          },
        });
        setResult({ kind: "logged", ...res });
      }
      reload();
    } catch (e) {
      setResult({ kind: "error", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const correct = async (mealId: string, text: string) => {
    setBusy(true);
    try {
      await api(`/api/meals/${mealId}/correct`, { method: "POST", json: { text } });
      setCorrecting(null);
      reload();
    } catch (e) {
      setResult({ kind: "error", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const weeklyPlan = async () => {
    setPlanBusy(true);
    try {
      const res = await api<Any>("/api/nutrition/weekly-plan", { method: "POST" });
      setShoppingList(res);
    } catch (e) {
      setResult({ kind: "error", message: (e as Error).message });
    } finally {
      setPlanBusy(false);
    }
  };

  const meals: Any[] = mealsData?.meals ?? [];

  return (
    <main className="px-4 pt-[calc(env(safe-area-inset-top)+1rem)] space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Eat</h1>
        <button
          onClick={weeklyPlan}
          disabled={planBusy}
          className="text-xs font-semibold rounded-full border border-line bg-surface px-3 py-2 text-muted flex items-center gap-1.5"
        >
          <CartIcon size={14} />
          {planBusy ? "Planning…" : "Weekly plan"}
        </button>
      </header>

      {macros && (
        <section className="card p-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Remaining today</span>
            <span className="font-bold tabular-nums">
              {macros.remaining.kcal} kcal · {macros.remaining.protein_g}g protein
            </span>
          </div>
          <p className="text-xs text-muted mt-2 leading-snug">{macros.recommendation}</p>
        </section>
      )}

      {/* mode toggle: log vs pre-eating advice */}
      <div className="grid grid-cols-2 rounded-2xl border border-line bg-surface p-1 text-sm font-semibold">
        {(["log", "advise"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-xl py-2 transition-colors ${
              mode === m ? "bg-accent text-black" : "text-muted"
            }`}
          >
            {m === "log" ? "Log a meal" : "How much should I eat?"}
          </button>
        ))}
      </div>

      <InputBar
        onSubmit={submit}
        busy={busy}
        placeholder={mode === "log" ? "e.g. 6 oz chicken, cup of rice…" : "Snap the plate before eating…"}
      />

      {result?.kind === "advice" && (
        <section className="card p-4 border-accent/30 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Coach says</h2>
          <p className="text-[15px] leading-relaxed">{result.advice}</p>
          <button
            className="text-xs font-semibold text-accent"
            onClick={async () => {
              await api(`/api/meals/${result.mealId}`, { method: "PATCH", json: { status: "confirmed", eaten_at: new Date().toISOString() } });
              setResult(null);
              reload();
            }}
          >
            I ate it — log as eaten ✓
          </button>
        </section>
      )}

      {result?.kind === "logged" && (
        <section className="card p-4 border-accent/30">
          <p className="text-sm">
            Logged <b>{result.description}</b> — {Math.round(result.totals.kcal)} kcal,{" "}
            {Math.round(result.totals.protein_g)}g protein
          </p>
          <p className="text-xs text-muted mt-1">Wrong? Tap the meal below to correct it.</p>
        </section>
      )}

      {result?.kind === "error" && <p className="text-sm text-amber">⚠️ {result.message}</p>}

      {shoppingList && <ShoppingListCard data={shoppingList} onClose={() => setShoppingList(null)} />}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Today&apos;s meals</h2>
        {meals.length === 0 && <p className="text-muted text-sm">Nothing logged yet.</p>}
        {meals.map((meal) => (
          <div key={meal.id} className="card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{meal.description ?? meal.meal_type}</p>
                <p className="text-xs text-muted">
                  {new Date(meal.eaten_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {" · "}{Math.round(meal.kcal)} kcal · {Math.round(meal.protein_g)}g protein
                  {meal.status === "planned" && " · not eaten yet"}
                  {meal.status === "corrected" && " · corrected"}
                </p>
              </div>
              <button
                className="text-xs text-info font-semibold"
                onClick={() => setCorrecting(correcting === meal.id ? null : meal.id)}
              >
                {correcting === meal.id ? "Cancel" : "Correct"}
              </button>
            </div>
            {(meal.items ?? []).length > 0 && (
              <ul className="mt-2 space-y-1">
                {meal.items.map((i: Any) => (
                  <li key={i.id} className="flex justify-between text-xs text-ink/75">
                    <span>
                      {i.description}
                      {i.grams ? ` · ${Math.round(i.grams)}g` : ""}
                      {i.confidence < 0.7 && !i.corrected && <span className="text-amber"> ~</span>}
                    </span>
                    <span className="tabular-nums text-muted">
                      {Math.round(i.kcal)} kcal / {Math.round(i.protein_g)}g P
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {correcting === meal.id && (
              <CorrectionInput onSubmit={(t) => correct(meal.id, t)} busy={busy} />
            )}
          </div>
        ))}
      </section>
    </main>
  );
}

function CorrectionInput({ onSubmit, busy }: { onSubmit: (t: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  return (
    <div className="mt-3 flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && text.trim() && onSubmit(text.trim())}
        placeholder='e.g. "actually that was 10 oz"'
        className="flex-1 rounded-xl border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <button
        disabled={busy || !text.trim()}
        onClick={() => onSubmit(text.trim())}
        className="rounded-xl bg-accent text-black text-sm font-bold px-4"
      >
        Fix
      </button>
    </div>
  );
}

function ShoppingListCard({ data, onClose }: { data: Any; onClose: () => void }) {
  const items: Any[] = data.shopping_list?.items ?? data.plan?.shopping_list ?? [];
  const stores = [...new Set(items.map((i: Any) => i.store))];
  return (
    <section className="card p-4 border-info/40 space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Shopping list</h2>
        <button className="text-muted text-xs" onClick={onClose}>✕</button>
      </div>
      {data.plan?.summary && <p className="text-xs text-muted">{data.plan.summary}</p>}
      {stores.map((store) => (
        <div key={String(store)}>
          <p className="font-bold text-sm uppercase tracking-wide">{String(store)}</p>
          <ul className="mt-1 space-y-0.5">
            {items.filter((i: Any) => i.store === store).map((i: Any, idx: number) => (
              <li key={idx} className="text-sm text-ink/85 flex justify-between">
                <span>{i.item}{i.quantity ? ` — ${i.quantity}` : ""}</span>
                <span className="text-muted text-xs">{i.category}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
