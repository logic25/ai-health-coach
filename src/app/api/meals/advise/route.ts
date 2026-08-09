/* POST /api/meals/advise — COACHING BEFORE EATING.
   Photograph food before eating: "How much of this should I eat?"
   { text?, imageBase64?, imageMediaType? } */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { adviseMeal } from "@/lib/coach";

const schema = z.object({
  text: z.string().optional(),
  imageBase64: z.string().optional(),
  imageMediaType: z.string().optional(),
});

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  if (!b.text && !b.imageBase64) {
    return json({ error: "text or imageBase64 required" }, { status: 400 });
  }
  const result = await adviseMeal(b);
  return json(result);
});
