/* NutritionProvider abstraction.
   The LLM identifies foods and estimates portions; nutrition FACTS come from
   structured databases, never from the model. Providers are pluggable so
   restaurant/product sources can be added later. */

import { query, queryOne } from "../db";

export interface NutritionPer100g {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number | null;
  sugar_g?: number | null;
}

export interface FoodResult {
  provider: string;
  providerId: string;
  name: string;
  brand?: string | null;
  barcode?: string | null;
  per100g: NutritionPer100g;
  serving?: { size_g?: number; description?: string } | null;
  raw?: unknown;
}

export interface NutritionProvider {
  name: string;
  search(term: string, limit?: number): Promise<FoodResult[]>;
  byBarcode?(barcode: string): Promise<FoodResult | null>;
}

// ---------------------------------------------------------------------------
// USDA FoodData Central — generic/whole foods
// ---------------------------------------------------------------------------

const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function usdaNutrients(food: any): NutritionPer100g | null {
  const get = (ids: number[]): number | null => {
    for (const n of food.foodNutrients ?? []) {
      const id = n.nutrientId ?? n.nutrient?.id;
      if (ids.includes(id)) return Number(n.value ?? n.amount ?? 0);
    }
    return null;
  };
  // 1008 kcal, 1003 protein, 1005 carbs, 1004 fat, 1079 fiber, 2000 sugar
  const kcal = get([1008]);
  const protein = get([1003]);
  if (kcal == null && protein == null) return null;
  return {
    kcal: kcal ?? 0,
    protein_g: protein ?? 0,
    carbs_g: get([1005]) ?? 0,
    fat_g: get([1004]) ?? 0,
    fiber_g: get([1079]),
    sugar_g: get([2000]),
  };
}

export class UsdaProvider implements NutritionProvider {
  name = "usda";

  async search(term: string, limit = 6): Promise<FoodResult[]> {
    const key = process.env.USDA_API_KEY || "DEMO_KEY";
    const res = await fetch(
      `${USDA_BASE}/foods/search?api_key=${key}&query=${encodeURIComponent(term)}` +
        `&dataType=Foundation,SR%20Legacy&pageSize=${limit}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error(`USDA search failed: ${res.status}`);
    const data = await res.json();
    const out: FoodResult[] = [];
    for (const f of data.foods ?? []) {
      const per100g = usdaNutrients(f);
      if (!per100g) continue;
      out.push({
        provider: "usda",
        providerId: String(f.fdcId),
        name: f.description,
        brand: f.brandOwner ?? null,
        per100g,
        serving: null,
        raw: { fdcId: f.fdcId, dataType: f.dataType },
      });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Open Food Facts — packaged/branded foods & barcodes
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function offToResult(p: any): FoodResult | null {
  const n = p.nutriments ?? {};
  const kcal = n["energy-kcal_100g"] ?? (n.energy_100g ? n.energy_100g / 4.184 : null);
  if (kcal == null) return null;
  return {
    provider: "openfoodfacts",
    providerId: String(p.code ?? p._id),
    name: p.product_name || p.generic_name || "Unknown product",
    brand: p.brands ?? null,
    barcode: String(p.code ?? ""),
    per100g: {
      kcal: Number(kcal),
      protein_g: Number(n.proteins_100g ?? 0),
      carbs_g: Number(n.carbohydrates_100g ?? 0),
      fat_g: Number(n.fat_100g ?? 0),
      fiber_g: n.fiber_100g != null ? Number(n.fiber_100g) : null,
      sugar_g: n.sugars_100g != null ? Number(n.sugars_100g) : null,
    },
    serving: p.serving_quantity
      ? { size_g: Number(p.serving_quantity), description: p.serving_size }
      : null,
    raw: { code: p.code },
  };
}

export class OpenFoodFactsProvider implements NutritionProvider {
  name = "openfoodfacts";

  async search(term: string, limit = 6): Promise<FoodResult[]> {
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(term)}` +
        `&search_simple=1&action=process&json=1&page_size=${limit}` +
        `&fields=code,product_name,generic_name,brands,nutriments,serving_quantity,serving_size`,
      {
        headers: { "User-Agent": "personal-health-coach-mvp/0.1" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) throw new Error(`OFF search failed: ${res.status}`);
    const data = await res.json();
    return (data.products ?? [])
      .map(offToResult)
      .filter((r: FoodResult | null): r is FoodResult => r !== null);
  }

  async byBarcode(barcode: string): Promise<FoodResult | null> {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}` +
        `?fields=code,product_name,generic_name,brands,nutriments,serving_quantity,serving_size`,
      {
        headers: { "User-Agent": "personal-health-coach-mvp/0.1" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OFF barcode failed: ${res.status}`);
    const data = await res.json();
    if (!data.product) return null;
    return offToResult(data.product);
  }
}

// ---------------------------------------------------------------------------

const providers: NutritionProvider[] = [new UsdaProvider(), new OpenFoodFactsProvider()];

export function getProviders(): NutritionProvider[] {
  return providers;
}

/** Cache a provider result as a food_reference row; returns its id. */
export async function cacheFoodReference(food: FoodResult): Promise<string> {
  const row = await queryOne(
    `insert into food_references (provider, provider_id, name, brand, barcode, per_100g, serving, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (provider, provider_id) do update set
       per_100g=excluded.per_100g, serving=excluded.serving, fetched_at=now()
     returning id`,
    [food.provider, food.providerId, food.name, food.brand ?? null,
     food.barcode ?? null, JSON.stringify(food.per100g),
     food.serving ? JSON.stringify(food.serving) : null,
     JSON.stringify(food.raw ?? {})]
  );
  return row!.id;
}

/** Search all providers (generic-first), tolerating individual failures. */
export async function searchFoods(term: string, limit = 8): Promise<FoodResult[]> {
  const settled = await Promise.allSettled(
    getProviders().map((p) => p.search(term, Math.ceil(limit / 2)))
  );
  const out: FoodResult[] = [];
  for (const s of settled) if (s.status === "fulfilled") out.push(...s.value);
  return out.slice(0, limit);
}

export async function lookupBarcode(barcode: string): Promise<FoodResult | null> {
  // check cache first
  const cached = await queryOne(
    `select * from food_references where barcode = $1 order by fetched_at desc limit 1`,
    [barcode]
  );
  if (cached) {
    return {
      provider: cached.provider,
      providerId: cached.provider_id,
      name: cached.name,
      brand: cached.brand,
      barcode: cached.barcode,
      per100g: cached.per_100g,
      serving: cached.serving,
    };
  }
  for (const p of getProviders()) {
    if (!p.byBarcode) continue;
    const r = await p.byBarcode(barcode);
    if (r) {
      await cacheFoodReference(r);
      return r;
    }
  }
  return null;
}

/** Scale per-100g values to a gram amount. */
export function scaleNutrition(per100g: NutritionPer100g, grams: number) {
  const f = grams / 100;
  const r = (v: number | null | undefined) =>
    v == null ? null : Math.round(v * f * 10) / 10;
  return {
    kcal: Math.round((per100g.kcal ?? 0) * f),
    protein_g: r(per100g.protein_g) ?? 0,
    carbs_g: r(per100g.carbs_g) ?? 0,
    fat_g: r(per100g.fat_g) ?? 0,
    fiber_g: r(per100g.fiber_g),
    sugar_g: r(per100g.sugar_g),
  };
}

export const OZ_TO_G = 28.3495;

/** Convert a (quantity, unit) pair to grams where deterministically possible. */
export function toGrams(quantity: number, unit: string): number | null {
  const u = unit.toLowerCase().trim();
  if (["g", "gram", "grams"].includes(u)) return quantity;
  if (["kg"].includes(u)) return quantity * 1000;
  if (["oz", "ounce", "ounces"].includes(u)) return quantity * OZ_TO_G;
  if (["lb", "lbs", "pound", "pounds"].includes(u)) return quantity * 453.592;
  return null; // cups/items etc. need food-specific density — LLM estimates those
}

/** Recompute a meal's cached totals from its items. */
export async function recomputeMealTotals(mealId: string): Promise<void> {
  await query(
    `update meals m set
       kcal = coalesce(t.kcal,0), protein_g = coalesce(t.protein_g,0),
       carbs_g = coalesce(t.carbs_g,0), fat_g = coalesce(t.fat_g,0),
       fiber_g = t.fiber_g, sugar_g = t.sugar_g, updated_at = now()
     from (
       select sum(kcal) kcal, sum(protein_g) protein_g, sum(carbs_g) carbs_g,
              sum(fat_g) fat_g, sum(fiber_g) fiber_g, sum(sugar_g) sugar_g
       from meal_items where meal_id = $1
     ) t
     where m.id = $1`,
    [mealId]
  );
}
