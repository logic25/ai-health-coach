/* POST /api/voice-note — fast voice input during a workout.
   { text, session_id? } → parsed into ExercisePerformance / Symptom /
   CoachObservation records with a short contextual reply. */
import { z } from "zod";
import { route, json } from "@/lib/api";
import { extractAndPersist } from "@/lib/extraction";

const schema = z.object({
  text: z.string().min(1),
  session_id: z.string().optional(),
});

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  const extracted = await extractAndPersist(b.text, {
    source: "voice",
    sessionId: b.session_id,
  });
  const reply =
    extracted.length > 0
      ? `Logged: ${extracted.map((e) => e.summary).join("; ")}`
      : "Noted.";
  return json({ extracted, reply });
});
