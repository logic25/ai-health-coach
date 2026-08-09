/* POST /api/transcribe — server-side speech-to-text fallback (OpenAI Whisper).
   Primary voice input uses the browser's Web Speech API (no key, no latency);
   this endpoint covers browsers without it. multipart/form-data { audio } */
import { route, json } from "@/lib/api";
import OpenAI from "openai";

export const POST = route(async (req) => {
  if (!process.env.OPENAI_API_KEY) {
    return json(
      { error: "OPENAI_API_KEY not set — use browser speech recognition instead" },
      { status: 424 }
    );
  }
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File)) return json({ error: "audio file required" }, { status: 400 });
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await client.audio.transcriptions.create({
    file: audio,
    model: "whisper-1",
  });
  return json({ text: result.text });
});
