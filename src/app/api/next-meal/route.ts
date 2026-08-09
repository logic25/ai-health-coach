/* GET /api/next-meal — context-aware next meal recommendation */
import { route, json } from "@/lib/api";
import { nextMealRecommendation } from "@/lib/coach";

export const GET = route(async () => {
  const result = await nextMealRecommendation();
  return json(result);
});
