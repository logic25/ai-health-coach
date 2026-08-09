/* GET  /api/meals?date=YYYY-MM-DD
   POST /api/meals — manual meal with explicit items (no estimation) */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { query, queryOne, todayLocal } from "@/lib/db";
import { recomputeMealTotals } from "@/lib/nutrition/providers";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? todayLocal();
  const tz = process.env.COACH_TZ || "America/New_York";
  const meals = await query(
    `select m.*, coalesce(json_agg(to_jsonb(i) order by i.created_at)
              filter (where i.id is not null), '[]') as items
     from meals m left join meal_items i on i.meal_id = m.id
     where (m.eaten_at at time zone $2)::date = $1::date
     group by m.id order by m.eaten_at`,
    [date, tz]
  );
  return json({ meals });
});

const itemSchema = z.object({
  description: z.string(),
  grams: z.number().optional(),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  kcal: z.number(),
  protein_g: z.number(),
  carbs_g: z.number().default(0),
  fat_g: z.number().default(0),
});

const schema = z.object({
  description: z.string(),
  meal_type: z.string().optional(),
  eaten_at: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  const meal = await queryOne(
    `insert into meals (eaten_at, meal_type, description, status, source)
     values (coalesce($1::timestamptz, now()), $2, $3, 'confirmed', 'manual') returning id`,
    [b.eaten_at ?? null, b.meal_type ?? null, b.description]
  );
  for (const i of b.items) {
    await query(
      `insert into meal_items (meal_id, description, quantity, unit, grams, kcal, protein_g, carbs_g, fat_g, confidence, estimation_method)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,1.0,'manual')`,
      [meal!.id, i.description, i.quantity ?? null, i.unit ?? null, i.grams ?? null,
       i.kcal, i.protein_g, i.carbs_g, i.fat_g]
    );
  }
  await recomputeMealTotals(meal!.id);
  const full = await queryOne(`select * from meals where id=$1`, [meal!.id]);
  return json({ meal: full }, { status: 201 });
});
