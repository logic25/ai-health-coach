/* GET /api/nutrition/search?q=chicken — manual product search across providers */
import { route, json } from "@/lib/api";
import { searchFoods } from "@/lib/nutrition/providers";

export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams.get("q");
  if (!q) return json({ error: "q required" }, { status: 400 });
  const results = await searchFoods(q, 10);
  return json({ results });
});
