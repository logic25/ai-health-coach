/* Coach chat orchestration.
   Every interaction: build deterministic HealthStateSnapshot -> reason ->
   respond -> extract structured updates -> persist. The model is explicitly
   told the snapshot is the ONLY source of truth for stored facts. */

import { getLlm, LlmContentPart } from "./llm";
import { buildSnapshot, renderSnapshot } from "./snapshot";
import { extractAndPersist, ExtractedRecord } from "./extraction";
import { query, queryOne } from "./db";
import { estimateMeal } from "./nutrition/estimate";

const COACH_SYSTEM = `You are a personal health, fitness, nutrition, recovery and lifestyle coach for one person. You are direct, warm, practical, and concise — a great coach, not a chatbot. If the profile preferences include coach_name, that is YOUR name — answer to it.

RULES:
1. The STRUCTURED STATE SNAPSHOT below is the canonical source of truth. When asked about any stored fact (measurements, workouts, findings, meals, targets), answer FROM THE SNAPSHOT deterministically. Never say you don't remember something that is in the snapshot.
2. Preserve the user's preferred daily rhythm (wake → bathroom → weigh → train → eat ~12-1pm → eating window until ~8-9pm → family → sleep) whenever practical, but adapt intelligently when real life interferes. A disrupted day is adapted, never "failed".
3. Distinguish observation vs hypothesis vs confirmed fact. Never present a hypothesis (e.g. "your hip restriction might be why X hurts") as fact.
4. Nutrition facts come from the food database, not from your memory. Portions and identification are estimates with stated confidence.
5. Do not encourage extreme restriction. If the day went off-plan, adjust the remainder intelligently.
6. Keep answers short and mobile-friendly. Lead with the answer/recommendation. Use plain text, minimal formatting, no headers unless truly needed.
7. When you make a meaningful coaching decision, state your reasoning in one short sentence.`;

export interface ChatResult {
  reply: string;
  extracted: ExtractedRecord[];
  userMessageId: string;
  assistantMessageId: string;
}

export async function coachChat(opts: {
  text: string;
  imageBase64?: string;
  imageMediaType?: string;
  modality?: "text" | "voice" | "photo";
}): Promise<ChatResult> {
  const modality = opts.modality ?? "text";

  const userMsg = await queryOne(
    `insert into chat_messages (role, content, modality, attachments)
     values ('user', $1, $2, $3) returning id`,
    [opts.text, modality, JSON.stringify(opts.imageBase64 ? [{ type: "image" }] : [])]
  );

  const [snapshot, history] = await Promise.all([
    buildSnapshot(),
    query(
      `select role, content from chat_messages
       where id <> $1 order by created_at desc limit 12`,
      [userMsg!.id]
    ),
  ]);

  const historyMessages = history
    .reverse()
    .map((h) => ({ role: h.role as "user" | "assistant", content: h.content as string }));

  const parts: LlmContentPart[] = [];
  if (opts.imageBase64) {
    parts.push({
      type: "image",
      mediaType: opts.imageMediaType ?? "image/jpeg",
      base64: opts.imageBase64,
    });
  }
  parts.push({ type: "text", text: opts.text });

  const llm = getLlm();
  const res = await llm.complete({
    system:
      COACH_SYSTEM +
      `\n\n=== STRUCTURED STATE SNAPSHOT (canonical truth, generated now) ===\n` +
      renderSnapshot(snapshot),
    messages: [...historyMessages, { role: "user", content: parts }],
    maxTokens: 1024,
  });

  // Persist assistant reply
  const asstMsg = await queryOne(
    `insert into chat_messages (role, content) values ('assistant', $1) returning id`,
    [res.text]
  );

  // Extract structured updates from the user's message (never from the model's reply)
  let extracted: ExtractedRecord[] = [];
  try {
    extracted = await extractAndPersist(opts.text, {
      source: modality === "text" ? "chat" : modality,
      chatMessageId: userMsg!.id,
    });
    if (extracted.length > 0) {
      await query(`update chat_messages set extracted=$2 where id=$1`, [
        userMsg!.id,
        JSON.stringify(extracted),
      ]);
    }
  } catch (e) {
    console.error("extraction failed", e);
  }

  return {
    reply: res.text,
    extracted,
    userMessageId: userMsg!.id,
    assistantMessageId: asstMsg!.id,
  };
}

/* ---------------------------------------------------------------------------
   Pre-eating meal advice: photograph food BEFORE eating, coach optimizes it. */

export async function adviseMeal(opts: {
  text?: string;
  imageBase64?: string;
  imageMediaType?: string;
}): Promise<{
  mealId: string;
  estimate: Record<string, unknown>;
  advice: string;
}> {
  // 1) Estimate what's on the plate (planned, not consumed)
  const est = await estimateMeal({
    text: opts.text,
    imageBase64: opts.imageBase64,
    imageMediaType: opts.imageMediaType,
    source: opts.imageBase64 ? "photo" : "text",
    planned: true,
  });

  // 2) Coach against today's remaining macros + training context
  const snapshot = await buildSnapshot();
  const llm = getLlm();
  const res = await llm.complete({
    system:
      COACH_SYSTEM +
      `\n\n=== STRUCTURED STATE SNAPSHOT ===\n` +
      renderSnapshot(snapshot),
    messages: [
      {
        role: "user",
        content:
          `I'm about to eat this meal (not eaten yet). Estimated contents:\n` +
          JSON.stringify(est.items.map((i) => ({
            item: i.description, grams: i.grams, kcal: i.kcal, protein_g: i.protein_g,
          })), null, 1) +
          `\nTotals: ~${est.totals.kcal} kcal, ${est.totals.protein_g}g protein.\n\n` +
          `Given my remaining calories/protein today, training, and goals: how much of this should I eat? ` +
          `Be specific about portions to increase/decrease/keep. 2-4 sentences.`,
      },
    ],
    maxTokens: 500,
  });

  await query(
    `insert into coach_decisions (kind, decision, reasoning, context, status)
     values ('meal_advice', $1, $2, $3, 'proposed')`,
    [res.text.slice(0, 500),
     "Pre-eating portion advice based on remaining macros and training context",
     JSON.stringify({ meal_id: est.mealId, totals: est.totals })]
  );

  return { mealId: est.mealId, estimate: est as unknown as Record<string, unknown>, advice: res.text };
}

/* ---------------------------------------------------------------------------
   Next-meal recommendation for the dashboard. Deterministic macro math +
   LLM phrasing (with a non-LLM fallback so the dashboard always works). */

export async function nextMealRecommendation(): Promise<{
  remaining: { kcal: number; protein_g: number };
  recommendation: string;
}> {
  const { todaysMacros } = await import("./nutrition/estimate");
  const macros = await todaysMacros();
  const remaining = {
    kcal: Math.max(0, Math.round(macros.remaining.kcal)),
    protein_g: Math.max(0, Math.round(macros.remaining.protein_g)),
  };

  // Deterministic baseline recommendation (works without an LLM key)
  let recommendation = deterministicNextMeal(remaining);

  try {
    const snapshot = await buildSnapshot();
    const llm = getLlm();
    const res = await llm.complete({
      system: COACH_SYSTEM + `\n\n=== SNAPSHOT ===\n` + renderSnapshot(snapshot),
      messages: [
        {
          role: "user",
          content: `Recommend my next meal. Remaining today: ${remaining.kcal} kcal, ${remaining.protein_g}g protein. One short specific suggestion (foods + rough portions), max 2 sentences.`,
        },
      ],
      maxTokens: 200,
    });
    if (res.text.trim()) recommendation = res.text.trim();
  } catch {
    // fall back to deterministic recommendation
  }

  return { remaining, recommendation };
}

function deterministicNextMeal(remaining: { kcal: number; protein_g: number }): string {
  if (remaining.kcal <= 100) {
    return remaining.protein_g > 15
      ? `You're at your calorie target but ${remaining.protein_g}g short on protein — a scoop of whey or Greek yogurt is the cleanest fill.`
      : "You've hit today's targets — nothing more needed.";
  }
  const chickenOz = Math.min(12, Math.max(4, Math.round(remaining.protein_g / 8.7)));
  return `~${chickenOz} oz chicken breast (or equivalent lean protein), a fist of vegetables, and a moderate starch portion fits your remaining ${remaining.kcal} kcal / ${remaining.protein_g}g protein.`;
}
