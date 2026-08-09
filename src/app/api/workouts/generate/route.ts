/* POST /api/workouts/generate — programming engine builds today's session.
   { date?, focusHint? } */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { generateWorkout } from "@/lib/programming";

const schema = z.object({
  date: z.string().optional(),
  focusHint: z.string().optional(),
});

export const POST = route(async (req) => {
  const b = schema.parse(await req.json().catch(() => ({})));
  const result = await generateWorkout(b);
  return json(result, { status: 201 });
});
