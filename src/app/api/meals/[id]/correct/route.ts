/* POST /api/meals/:id/correct — { text: "actually that's 10 oz" }
   Recalculates immediately; correction stored for future calibration. */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { correctMeal } from "@/lib/nutrition/estimate";
import { queryOne } from "@/lib/db";

const schema = z.object({ text: z.string().min(1) });

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const meal = await queryOne(`select id from meals where id=$1`, [id]);
  if (!meal) return json({ error: "meal not found" }, { status: 404 });
  const b = schema.parse(await req.json());
  const result = await correctMeal(id, b.text);
  return json(result);
});
