/* Meal estimation pipeline.
   LLM: identification + portion estimation (+ correction interpretation).
   Nutrition DB: facts. App: math.
   Every estimated item carries confidence and provenance; corrections update
   the record and are stored as context for future estimates. */

import { getLlm, LlmContentPart, LlmTool } from "../llm";
import { query, queryOne, todayLocal } from "../db";
import {
  searchFoods,
  cacheFoodReference,
  scaleNutrition,
  toGrams,
  NutritionPer100g,
} from "./providers";

interface IdentifiedItem {
  description: string;
  search_term: string;
  quantity: number;
  unit: string;
  grams_estimate: number;
  confidence: number;
  packaged: boolean;
}

const IDENTIFY_TOOL: LlmTool = {
  name: "identify_food_items",
  description: "Identify each distinct food item and estimate its portion.",
  inputSchema: {
    type: "object",
    properties: {
      meal_description: { type: "string", description: "short human name for the whole meal" },
      meal_type: { type: "string", description: "breakfast | lunch | dinner | snack" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "item as seen/stated, e.g. 'grilled chicken breast'" },
            search_term: { type: "string", description: "generic term for a nutrition database lookup, e.g. 'chicken breast grilled'" },
            quantity: { type: "number" },
            unit: { type: "string", description: "g | oz | cup | item | slice | tbsp" },
            grams_estimate: { type: "number", description: "best estimate of total edible weight in grams" },
            confidence: { type: "number", description: "0-1 confidence in the portion estimate" },
            packaged: { type: "boolean", description: "true if branded/packaged product" },
          },
          required: ["description", "search_term", "quantity", "unit", "grams_estimate", "confidence"],
        },
      },
    },
    required: ["items"],
  },
};

async function correctionContext(): Promise<string> {
  const rows = await query(
    `select description, correction_note from meal_items
     where corrected and correction_note is not null
     order by updated_at desc limit 10`
  );
  if (rows.length === 0) return "";
  return (
    "\nPast portion corrections by this user (use to calibrate estimates):\n" +
    rows.map((r) => `- ${r.description}: ${r.correction_note}`).join("\n")
  );
}

export interface EstimatedMeal {
  mealId: string;
  description: string;
  items: Record<string, unknown>[];
  totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
}

/** Create a meal from text, voice transcript, or photo. */
export async function estimateMeal(opts: {
  text?: string;
  imageBase64?: string;
  imageMediaType?: string;
  source: "text" | "voice" | "photo";
  eatenAt?: string;
  planned?: boolean; // pre-eating: not consumed yet
}): Promise<EstimatedMeal> {
  const llm = getLlm();
  const corrections = await correctionContext();

  const parts: LlmContentPart[] = [];
  if (opts.imageBase64) {
    parts.push({
      type: "image",
      mediaType: opts.imageMediaType ?? "image/jpeg",
      base64: opts.imageBase64,
    });
  }
  parts.push({
    type: "text",
    text: opts.text
      ? `Identify the food items: ${opts.text}`
      : "Identify the food items in this photo and estimate portions.",
  });

  const res = await llm.complete({
    system:
      `You identify foods and estimate portions for a nutrition log. Be realistic about portion sizes. ` +
      `Use generic search terms that a food database (USDA) will match. For mixed dishes, break into major components.` +
      corrections,
    messages: [{ role: "user", content: parts }],
    tools: [IDENTIFY_TOOL],
    toolChoice: { name: "identify_food_items" },
    maxTokens: 1500,
    temperature: 0,
  });

  const call = res.toolCalls.find((c) => c.name === "identify_food_items");
  const identified = (call?.input.items ?? []) as IdentifiedItem[];
  const mealDescription =
    (call?.input.meal_description as string) || opts.text || "Meal";
  const mealType = (call?.input.meal_type as string) || guessMealType();

  const meal = await queryOne(
    `insert into meals (eaten_at, meal_type, description, status, source, notes)
     values (coalesce($1::timestamptz, now()), $2, $3, $4, $5, $6) returning id`,
    [opts.eatenAt ?? null, mealType, mealDescription,
     opts.planned ? "planned" : "estimated", opts.source,
     opts.planned ? "Pre-eating estimate (not yet consumed)" : null]
  );
  const mealId = meal!.id as string;

  for (const item of identified) {
    await addItemToMeal(mealId, item, opts.source);
  }

  const { recomputeMealTotals } = await import("./providers");
  await recomputeMealTotals(mealId);

  const items = await query(`select * from meal_items where meal_id=$1`, [mealId]);
  const totals = await queryOne(`select kcal, protein_g, carbs_g, fat_g from meals where id=$1`, [mealId]);
  return { mealId, description: mealDescription, items, totals: totals! };
}

async function addItemToMeal(
  mealId: string,
  item: IdentifiedItem,
  source: string
): Promise<void> {
  const grams =
    toGrams(item.quantity, item.unit) ?? item.grams_estimate ?? null;

  // Facts from the nutrition DB (never invented by the model)
  let per100g: NutritionPer100g | null = null;
  let foodRefId: string | null = null;
  let matchedName: string | null = null;
  try {
    const results = await searchFoods(item.search_term, 5);
    const preferred = item.packaged
      ? results.find((r) => r.provider === "openfoodfacts") ?? results[0]
      : results.find((r) => r.provider === "usda") ?? results[0];
    if (preferred) {
      per100g = preferred.per100g;
      matchedName = preferred.name;
      foodRefId = await cacheFoodReference(preferred);
    }
  } catch {
    // providers unreachable — item is stored without macros, flagged low confidence
  }

  const scaled =
    per100g && grams
      ? scaleNutrition(per100g, grams)
      : { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null, sugar_g: null };

  await query(
    `insert into meal_items (meal_id, food_reference_id, description, quantity, unit, grams,
       kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, confidence, estimation_method, provenance)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [mealId, foodRefId, item.description, item.quantity, item.unit, grams,
     scaled.kcal, scaled.protein_g, scaled.carbs_g, scaled.fat_g,
     scaled.fiber_g, scaled.sugar_g,
     per100g ? item.confidence : Math.min(item.confidence, 0.3),
     source === "photo" ? "vision" : source,
     JSON.stringify({ search_term: item.search_term, matched: matchedName, grams_source: toGrams(item.quantity, item.unit) ? "unit_conversion" : "llm_estimate" })]
  );
}

const CORRECT_TOOL: LlmTool = {
  name: "apply_correction",
  description: "Apply the user's correction to meal items.",
  inputSchema: {
    type: "object",
    properties: {
      corrections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item_id: { type: "string", description: "id of the item being corrected" },
            new_quantity: { type: "number" },
            new_unit: { type: "string" },
            new_grams: { type: "number" },
            new_description: { type: "string" },
            remove: { type: "boolean" },
            note: { type: "string", description: "what changed, e.g. 'was 170g, actually 10 oz'" },
          },
          required: ["item_id", "note"],
        },
      },
      new_items: {
        type: "array",
        description: "items the user says were missing",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            search_term: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
            grams_estimate: { type: "number" },
            confidence: { type: "number" },
            packaged: { type: "boolean" },
          },
          required: ["description", "search_term", "quantity", "unit", "grams_estimate", "confidence"],
        },
      },
    },
  },
};

/** Correct a meal from free text ("actually that was 10 oz"). Recalculates immediately. */
export async function correctMeal(mealId: string, text: string) {
  const items = await query(
    `select id, description, quantity, unit, grams, kcal, protein_g from meal_items where meal_id=$1`,
    [mealId]
  );
  const llm = getLlm();
  const res = await llm.complete({
    system:
      "The user is correcting a logged meal. Map their correction onto the item list. Convert stated units faithfully; do not change items they did not mention.",
    messages: [
      {
        role: "user",
        content: `Current items:\n${JSON.stringify(items, null, 1)}\n\nUser correction: "${text}"`,
      },
    ],
    tools: [CORRECT_TOOL],
    toolChoice: { name: "apply_correction" },
    maxTokens: 1200,
    temperature: 0,
  });

  const call = res.toolCalls.find((c) => c.name === "apply_correction");
  if (!call) return { updated: 0 };

  let updated = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of (call.input.corrections ?? []) as any[]) {
    const item = await queryOne(`select * from meal_items where id=$1 and meal_id=$2`, [c.item_id, mealId]);
    if (!item) continue;
    if (c.remove) {
      await query(`delete from meal_items where id=$1`, [c.item_id]);
      updated++;
      continue;
    }
    const grams =
      c.new_grams ??
      (c.new_quantity != null && c.new_unit ? toGrams(c.new_quantity, c.new_unit) : null) ??
      item.grams;

    // rescale from the linked food reference (facts stay from the DB)
    let scaled = null;
    if (item.food_reference_id && grams) {
      const ref = await queryOne(`select per_100g from food_references where id=$1`, [item.food_reference_id]);
      if (ref) scaled = scaleNutrition(ref.per_100g, grams);
    } else if (grams && item.grams > 0) {
      // no reference — scale existing macros proportionally
      const f = grams / item.grams;
      scaled = {
        kcal: Math.round(item.kcal * f),
        protein_g: +(item.protein_g * f).toFixed(1),
        carbs_g: +(item.carbs_g * f).toFixed(1),
        fat_g: +(item.fat_g * f).toFixed(1),
        fiber_g: item.fiber_g != null ? +(item.fiber_g * f).toFixed(1) : null,
        sugar_g: item.sugar_g != null ? +(item.sugar_g * f).toFixed(1) : null,
      };
    }

    await query(
      `update meal_items set
         description = coalesce($2, description),
         quantity = coalesce($3, quantity), unit = coalesce($4, unit),
         grams = coalesce($5, grams),
         kcal = coalesce($6, kcal), protein_g = coalesce($7, protein_g),
         carbs_g = coalesce($8, carbs_g), fat_g = coalesce($9, fat_g),
         fiber_g = coalesce($10, fiber_g), sugar_g = coalesce($11, sugar_g),
         corrected = true, correction_note = $12, confidence = 1.0, updated_at = now()
       where id = $1`,
      [c.item_id, c.new_description ?? null, c.new_quantity ?? null, c.new_unit ?? null,
       grams, scaled?.kcal ?? null, scaled?.protein_g ?? null, scaled?.carbs_g ?? null,
       scaled?.fat_g ?? null, scaled?.fiber_g ?? null, scaled?.sugar_g ?? null, c.note]
    );
    updated++;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of (call.input.new_items ?? []) as any[]) {
    await addItemToMeal(mealId, item as IdentifiedItem, "text");
    updated++;
  }

  const { recomputeMealTotals } = await import("./providers");
  await recomputeMealTotals(mealId);
  await query(`update meals set status='corrected', updated_at=now() where id=$1`, [mealId]);

  const totals = await queryOne(`select kcal, protein_g, carbs_g, fat_g from meals where id=$1`, [mealId]);
  const newItems = await query(`select * from meal_items where meal_id=$1`, [mealId]);
  return { updated, totals, items: newItems };
}

/** Today's consumed totals vs target + remaining. */
export async function todaysMacros() {
  const today = todayLocal();
  const tz = process.env.COACH_TZ || "America/New_York";
  const [consumed, target] = await Promise.all([
    queryOne(
      `select coalesce(round(sum(kcal)),0) kcal, coalesce(round(sum(protein_g)),0) protein_g,
              coalesce(round(sum(carbs_g)),0) carbs_g, coalesce(round(sum(fat_g)),0) fat_g
       from meals where (eaten_at at time zone $2)::date = $1::date and status <> 'planned'`,
      [today, tz]
    ),
    queryOne(
      `select * from (
         select * from nutrition_targets where date = $1
         union all
         select * from nutrition_targets where date is null
       ) t limit 1`,
      [today]
    ),
  ]);
  return {
    consumed: consumed!,
    target: target
      ? { kcal: target.kcal, protein_g: target.protein_g, eating_window_start: target.eating_window_start, eating_window_end: target.eating_window_end }
      : { kcal: 2000, protein_g: 185 },
    remaining: {
      kcal: (target?.kcal ?? 2000) - consumed!.kcal,
      protein_g: (target?.protein_g ?? 185) - consumed!.protein_g,
    },
  };
}

function guessMealType(): string {
  const tz = process.env.COACH_TZ || "America/New_York";
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date())
  );
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 20) return "dinner";
  return "snack";
}
