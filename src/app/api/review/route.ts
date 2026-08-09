/* GET  /api/review — all weekly reviews
   POST /api/review — compute/recompute a weekly review { week_start? } */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { query } from "@/lib/db";
import { runWeeklyReview } from "@/lib/scoring";

export const GET = route(async () => {
  const reviews = await query(`select * from weekly_reviews order by week_start desc`);
  const expected = await query(`select * from expected_outcomes order by week_start desc, metric`);
  const actual = await query(`select * from actual_outcomes order by week_start desc, metric`);
  return json({ reviews, expected, actual });
});

const schema = z.object({ week_start: z.string().optional() });

export const POST = route(async (req) => {
  const b = schema.parse(await req.json().catch(() => ({})));
  const result = await runWeeklyReview(b.week_start);
  return json(result);
});
