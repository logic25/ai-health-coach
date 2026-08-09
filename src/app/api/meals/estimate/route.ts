/* POST /api/meals/estimate — log a meal from text/voice/photo.
   { text?, imageBase64?, imageMediaType?, source, planned? } */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { estimateMeal } from "@/lib/nutrition/estimate";

const schema = z.object({
  text: z.string().optional(),
  imageBase64: z.string().optional(),
  imageMediaType: z.string().optional(),
  source: z.enum(["text", "voice", "photo"]).default("text"),
  planned: z.boolean().optional(),
  eaten_at: z.string().optional(),
});

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  if (!b.text && !b.imageBase64) {
    return json({ error: "text or imageBase64 required" }, { status: 400 });
  }
  const result = await estimateMeal({
    text: b.text,
    imageBase64: b.imageBase64,
    imageMediaType: b.imageMediaType,
    source: b.source,
    planned: b.planned,
    eatenAt: b.eaten_at,
  });
  return json(result, { status: 201 });
});
