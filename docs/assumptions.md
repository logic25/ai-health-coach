# Assumptions & decisions log

Recorded per the spec ("record the assumption and proceed"). All are easy to
change later.

1. **Repo layout** — the existing repo contains CareThread, an unrelated
   Lovable-generated app. The coach lives in `coach/` as a self-contained
   Next.js app; CareThread is untouched. On Vercel set Root Directory =
   `coach/`.
2. **Database access** — plain Postgres via `pg` + SQL (no Supabase client/RLS).
   Single-user app needs no auth rows; Supabase is used purely as hosted
   Postgres, so local dev works against any Postgres and prod against the
   Supabase connection string.
3. **LLM default** — Anthropic (`claude-sonnet-5`) behind the provider
   abstraction; OpenAI supported via env switch. Vision goes through the same
   interface.
4. **Voice** — browser Web Speech API first (zero-latency, no key); Whisper via
   `/api/transcribe` as fallback. No streaming voice pipeline in the MVP.
5. **Images** — meal/progress photos are compressed client-side (~1000-1400px
   JPEG) and stored as base64 data URLs in Postgres. Fine at single-user scale;
   swap to Supabase Storage later without schema changes (the `url` column just
   starts holding real URLs).
6. **Barcode input** — implemented as manual barcode entry / photo of the label
   via the vision model + `/api/nutrition/barcode/:code`. No client-side
   camera barcode-scanner library in the MVP.
7. **Recovery score** — deterministic weighted blend (sleep 35%, HRV-vs-14-day
   baseline 25%, RHR-vs-baseline 20%, soreness 10%, yesterday's load 10%),
   renormalized over available components; neutral 70 when no data. Bands:
   ≥70 green, 50-69 yellow, <50 red.
8. **Calorie targets** — seeded at 2,000 kcal / 185 g protein with a 12:00-20:30
   window. The weekly loop updates targets from the observed personal energy
   model (1 lb ≈ 3,500 kcal) once ≥5 logged days/week exist; single-week
   estimates carry low confidence by design.
9. **Kcal adherence** — a day "adheres" within ±12% of target. Protein target
   day = ≥180 g (goal: 6/7 days).
10. **Week starts Monday.** Weekly review normally runs for the *previous*
    week; any week can be recomputed idempotently.
11. **Scheduling** — preferred slot 07:30 local. Without a connected calendar
    the coach assumes the morning slot is free (`slot_source: "assumed"`).
    Calendar events are read into a local cache (`calendar_events`) so
    scheduling logic keeps working offline/stale.
12. **Notifications** — in-app cards only (no push in MVP), throttled to one
    unseen notification per kind per day.
13. **Sandbox network** — in this dev container the USDA / Open Food Facts /
    Google endpoints are blocked by the environment's network policy, so
    provider lookups return empty here; code paths tolerate provider failure
    (items stored with low confidence). Works normally where outbound HTTPS is
    open.
14. **Chat history** — last 12 messages are sent for conversational continuity,
    but stored facts always come from the snapshot; the transcript is never
    queried to answer factual questions.
15. **CV future-proofing** — `workout_sessions.cv_observations` and
    `exercise_performances.cv_data` are JSONB attachment points for future
    computer-vision form data; no CV in MVP.
