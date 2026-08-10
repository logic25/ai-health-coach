/* GET /api/strength — per-exercise strength progression: estimated 1RM
   trends, all-time bests, latest sets, and suggested next loads. */
import { route, json } from "@/lib/api";
import { strengthOverview } from "@/lib/strength";

export const GET = route(async () => {
  const exercises = await strengthOverview();
  return json({ exercises });
});
