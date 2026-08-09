/* GET  /api/chat — recent transcript
   POST /api/chat — { text, imageBase64?, imageMediaType?, modality? } */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { query } from "@/lib/db";
import { coachChat } from "@/lib/coach";

export const GET = route(async () => {
  const rows = await query(
    `select id, role, content, modality, extracted, created_at
     from chat_messages order by created_at desc limit 50`
  );
  return json({ messages: rows.reverse() });
});

const schema = z.object({
  text: z.string().min(1),
  imageBase64: z.string().optional(),
  imageMediaType: z.string().optional(),
  modality: z.enum(["text", "voice", "photo"]).optional(),
});

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  const result = await coachChat(b);
  return json(result);
});
