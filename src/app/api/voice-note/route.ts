/* POST /api/voice-note — fast voice input during a workout.
   { text, session_id? } → parsed into ExercisePerformance / Symptom /
   CoachObservation records. Pure logging statements get a terse "Logged:"
   confirmation; questions and interruptions ("what's next?", "I have to
   stop — kid woke up") are routed through the coach for a contextual,
   snapshot-aware reply. */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { extractAndPersist, ExtractedRecord } from "@/lib/extraction";
import { llmAvailable } from "@/lib/llm";

const schema = z.object({
  text: z.string().min(1),
  session_id: z.string().optional(),
});

function wantsReply(text: string, extracted: ExtractedRecord[]): boolean {
  if (text.includes("?")) return true;
  if (extracted.length === 0) return true; // not a clean log — talk to the coach
  return /\b(stop|pause|interrupt|swap|instead|help|hurts|can'?t|too (heavy|hard|easy)|what|should|how)\b/i.test(text);
}

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  let extracted: ExtractedRecord[] = [];
  try {
    extracted = await extractAndPersist(b.text, {
      source: "voice",
      sessionId: b.session_id,
    });
  } catch {
    // extraction needs an LLM key; fall through so the reply path can still work
  }

  let reply =
    extracted.length > 0
      ? `Logged: ${extracted.map((e) => e.summary).join("; ")}`
      : "Noted.";

  if (llmAvailable() && wantsReply(b.text, extracted)) {
    try {
      const { coachChat } = await import("@/lib/coach");
      const res = await coachChat({ text: b.text, modality: "voice" });
      reply = res.reply;
    } catch {
      // keep the terse confirmation
    }
  }

  return json({ extracted, reply });
});
