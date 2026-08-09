/* POST /api/morning — run the morning coach routine */
import { route, json } from "@/lib/api";
import { runMorningCoach } from "@/lib/morning";

export const POST = route(async () => {
  const result = await runMorningCoach();
  return json(result);
});
