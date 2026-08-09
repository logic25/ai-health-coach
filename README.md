# Coach — Personal AI Health & Fitness Coach (4-Week Experiment MVP)

A private, single-user closed-loop coach: it **observes → understands → plans →
schedules → coaches → measures → compares expected vs actual → adapts →
remembers**. The chat transcript is never the source of truth — every meaningful
fact becomes a structured record, and every AI interaction reasons over a
deterministic `HealthStateSnapshot` built from the database.

## Stack

- **Next.js 16 (App Router) + TypeScript + Tailwind v4** — mobile-first UI
- **Postgres** (Supabase in production, any Postgres in dev) via `pg` + plain SQL
- **LLM abstraction** (`src/lib/llm`) — Anthropic (default) or OpenAI, switchable
  with `COACH_LLM_PROVIDER`; vision + tool-use through one interface
- **Voice** — browser Web Speech API (primary), `/api/transcribe` Whisper fallback
- **Nutrition facts** — USDA FoodData Central + Open Food Facts behind a
  `NutritionProvider` interface (restaurant/product providers plug in later)
- **Google Calendar** — REST OAuth integration (read availability + create events)
- **Apple Health** — clean ingestion API (`docs/apple-health-schema.md`); no
  direct HealthKit dependency

## Getting started

```bash
cd coach
npm install
cp .env.local.example .env.local   # then fill in values (see below)
npm run db:migrate
npm run db:seed
npm run dev
```

Env (`.env.local`):

| var | required | purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection (Supabase: Settings → Database → URI) |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | for AI features | chat, meal estimation, workout LLM reasoning. Deterministic fallbacks exist for the dashboard, next-meal, and workout builder |
| `COACH_LLM_PROVIDER` | no | `anthropic` (default) or `openai` |
| `COACH_TZ` | no | local timezone (default America/New_York) |
| `HEALTH_IMPORT_TOKEN` | yes | bearer token the HealthKit bridge sends |
| `USDA_API_KEY` | no | free key; `DEMO_KEY` works with low rate limits |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | for calendar | OAuth app (Calendar API enabled). Visit `/api/calendar/auth` once to connect |
| `APP_BASE_URL` | no | used in calendar event deep links |

Deploy: Vercel project with **Root Directory = `coach/`**, env vars above,
`DATABASE_URL` pointed at Supabase.

## The closed loop, concretely

1. **Morning** — `POST /api/morning`: checks weigh-in, syncs calendar, computes
   recovery (sleep + HRV/RHR vs 14-day baseline + soreness + yesterday's load),
   generates/reuses today's workout, proposes a slot (preferred 7:30am when
   free, else earliest adequate calendar window), sets targets, writes ONE
   daily focus. All decisions land in `coach_decisions` with reasoning.
2. **Training** — programming engine = plan template + curated 42-exercise
   library + user state + adaptation rules + LLM reasoning. Guardrails in code:
   red recovery forces mobility/recovery; yellow cuts volume ~30% and caps RPE;
   hallucinated exercise slugs are dropped. Deterministic template builder runs
   when no LLM key is set. Workout mode logs sets with one tap; voice notes
   ("only got 7", "right shoulder pinched") are parsed into
   `exercise_performances` / `symptoms` / `coach_observations`.
3. **Eating** — the LLM identifies foods and estimates portions; **facts come
   from the nutrition databases**; the app does the math. Every item carries
   confidence + provenance. Corrections ("actually that's 10 oz") rescale from
   the linked food reference immediately and feed future estimates. "How much
   of this should I eat?" photographs the plate BEFORE eating and coaches
   portions against remaining macros + today's training.
4. **Weekly** — `POST /api/review`: expected outcomes (defined before the week)
   vs computed actuals; **execution score** (did I follow the plan?) separate
   from **outcome score** (did the body respond?); decision logic
   (maintain / adjust assumptions / focus adherence) stored with reasoning.
   Weekly energy-balance observations accumulate into a personal TDEE model.
   `POST /api/nutrition/weekly-plan` builds the food plan + store-grouped
   shopping list from what was actually eaten.

## Memory failure target: zero

`src/lib/snapshot.ts` deterministically assembles goals, latest measurements,
trends, findings, symptoms, workouts, performances, nutrition, calendar and
recent decisions before every AI call. If a fact is in the database, it is in
the snapshot — the model is instructed to answer stored-fact questions from it,
never from conversation memory. Extraction (`src/lib/extraction.ts`) writes
user statements back as records, keeping observation / hypothesis / confirmed
status separate (causal guesses are stored as hypotheses, never silently
promoted to facts).

## Project map

```
src/db/migrations/    schema (all core models incl. provenance/confidence)
src/db/seed/          42-exercise curated library
scripts/              migrate + seed (npm run db:migrate / db:seed)
src/lib/              snapshot, extraction, coach, programming, scoring,
                      recovery, applehealth, calendar, morning, llm/, nutrition/
src/app/api/          30 route handlers (see below)
src/app/              Today / Train / Eat / Progress / Coach (+ workout mode)
docs/                 apple-health-schema.md, assumptions.md
```

Key endpoints: `/api/health/import`, `/api/chat`, `/api/meals/estimate`,
`/api/meals/:id/correct`, `/api/meals/advise`, `/api/next-meal`,
`/api/workouts/generate`, `/api/workouts/:id/schedule`, `/api/voice-note`,
`/api/morning`, `/api/review`, `/api/experiment`,
`/api/calendar/{auth,status,schedule-week}`, `/api/nutrition/{search,barcode,weekly-plan}`.

## Tests

`npm test` — 27 unit tests over the deterministic core: recovery scoring,
execution/outcome scores + decision logic, portion math (incl. the
170 g → 10 oz correction example), Apple Health schema, timezone/scheduling
helpers, and the template workout builder.
