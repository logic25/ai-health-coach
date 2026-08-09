-- AI Health Coach — canonical structured state schema
-- Single-user MVP: no multi-tenancy, no RLS. All records carry
-- source / confidence / provenance where estimation is involved so the
-- coach can distinguish observation, hypothesis, and confirmed fact.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profile & goals
-- ---------------------------------------------------------------------------

create table user_profile (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text,
  sex           text,
  birth_date    date,
  height_in     numeric,
  timezone      text not null default 'America/New_York',
  units         text not null default 'imperial',
  -- preferred daily rhythm, eating window, workout time, food preferences…
  preferences   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table goals (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,               -- body_comp | strength | aerobic | mobility | habit | nutrition
  description   text not null,
  target        jsonb,                       -- { metric, value, unit, direction }
  target_date   date,
  priority      int not null default 1,
  status        text not null default 'active',  -- active | achieved | paused | dropped
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Measurements & daily state
-- ---------------------------------------------------------------------------

create table measurements (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,               -- weight | waist | body_fat_pct | chest | hips | …
  value         numeric not null,
  unit          text not null,               -- lb | in | pct
  location      text,                        -- e.g. 'navel' for waist
  method        text,                        -- e.g. 'tape relaxed', 'scale'
  state         text,                        -- relaxed | flexed | fasted …
  timing        text,                        -- morning | evening …
  taken_at      timestamptz not null default now(),
  source        text not null default 'manual',   -- manual | chat | apple_health | seed
  confidence    numeric not null default 1.0,     -- 0..1
  notes         text,
  provenance    jsonb not null default '{}'::jsonb, -- raw payload / chat msg id / import batch
  created_at    timestamptz not null default now()
);
create index on measurements (kind, taken_at desc);

create table daily_states (
  id              uuid primary key default gen_random_uuid(),
  date            date not null unique,
  energy          int,                       -- 1..10 subjective
  hunger          int,                       -- 1..10
  soreness        int,                       -- 1..10 overall
  stress          int,                       -- 1..10
  mood            text,
  recovery_score  int,                       -- 0..100 computed
  recovery_band   text,                      -- green | yellow | red
  recovery_detail jsonb,                     -- inputs used for the score
  notes           text,
  source          text not null default 'manual',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table recovery_metrics (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  kind          text not null,               -- sleep_duration_min | sleep_deep_min | sleep_rem_min | sleep_core_min | sleep_awake_min | hrv_ms | resting_hr_bpm | vo2_max | respiratory_rate
  value         numeric not null,
  unit          text not null,
  taken_at      timestamptz,
  detail        jsonb not null default '{}'::jsonb,
  source        text not null default 'apple_health',
  confidence    numeric not null default 1.0,
  created_at    timestamptz not null default now(),
  unique (date, kind, source)
);
create index on recovery_metrics (kind, date desc);

-- ---------------------------------------------------------------------------
-- Activity (steps, calories, distance) from Apple Health
-- ---------------------------------------------------------------------------

create table activity_metrics (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  kind          text not null,               -- steps | active_kcal | exercise_min | distance_mi
  value         numeric not null,
  unit          text not null,
  source        text not null default 'apple_health',
  created_at    timestamptz not null default now(),
  unique (date, kind, source)
);
create index on activity_metrics (kind, date desc);

-- ---------------------------------------------------------------------------
-- Training
-- ---------------------------------------------------------------------------

create table exercises (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  name               text not null,
  movement_pattern   text not null,          -- squat | hinge | lunge | horizontal_push | …
  primary_muscles    text[] not null default '{}',
  secondary_muscles  text[] not null default '{}',
  purpose            text,
  equipment          text[] not null default '{}',
  difficulty         int not null default 2, -- 1..5
  instructions       text,
  form_cues          text[] not null default '{}',
  common_errors      text[] not null default '{}',
  regressions        text[] not null default '{}',
  progressions       text[] not null default '{}',
  contraindications  text[] not null default '{}',
  demo_url           text not null default '',
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create table training_plans (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  start_date    date not null,
  end_date      date,
  status        text not null default 'active',  -- active | completed | abandoned
  -- weekly template: days, focus, session length, weekly targets
  template      jsonb not null default '{}'::jsonb,
  reasoning     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table workouts (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid references training_plans(id),
  title             text not null,
  focus             text,                    -- lower_core | upper_core | full_body | mobility | conditioning | boxing
  scheduled_date    date,
  scheduled_start   timestamptz,
  duration_min      int,
  status            text not null default 'planned', -- planned | scheduled | in_progress | completed | skipped | rescheduled
  status_reason     text,                    -- why skipped/rescheduled
  calendar_event_id text,                    -- google calendar event id when scheduled
  reasoning         text,                    -- why the coach built the workout this way
  source            text not null default 'engine',  -- engine | manual | import
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on workouts (scheduled_date desc);

create table workout_sessions (
  id             uuid primary key default gen_random_uuid(),
  workout_id     uuid references workouts(id),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  session_rpe    numeric,                    -- overall session RPE 1..10
  energy         int,
  notes          text,
  source         text not null default 'manual',   -- manual | apple_health | import
  -- future computer-vision observations attach here (expected vs actual form,
  -- reps, ROM, tempo, asymmetry) without schema changes
  cv_observations jsonb not null default '[]'::jsonb,
  external_id    text,                       -- apple health workout uuid
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index on workout_sessions (started_at desc);

create table exercise_prescriptions (
  id             uuid primary key default gen_random_uuid(),
  workout_id     uuid not null references workouts(id) on delete cascade,
  exercise_id    uuid not null references exercises(id),
  seq            int not null,
  sets           int,
  reps           text,                       -- '8' | '8-10' | 'AMRAP'
  time_seconds   int,
  load_lb        numeric,
  rest_seconds   int,
  tempo          text,
  target_rpe     numeric,
  notes          text,
  reasoning      text                        -- why chosen / progressed / regressed / substituted
);
create index on exercise_prescriptions (workout_id, seq);

create table exercise_performances (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid references workout_sessions(id) on delete cascade,
  prescription_id  uuid references exercise_prescriptions(id),
  exercise_id      uuid not null references exercises(id),
  set_number       int not null default 1,
  reps             int,
  load_lb          numeric,
  time_seconds     int,
  rpe              numeric,
  completed        boolean not null default true,
  notes            text,
  source           text not null default 'manual',  -- manual | voice | chat
  confidence       numeric not null default 1.0,
  -- future CV per-set data: actual reps, ROM, tempo, asymmetry
  cv_data          jsonb not null default '{}'::jsonb,
  recorded_at      timestamptz not null default now()
);
create index on exercise_performances (exercise_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Body model: mobility, symptoms, limitations
-- ---------------------------------------------------------------------------

create table mobility_findings (
  id             uuid primary key default gen_random_uuid(),
  area           text not null,              -- hip | ankle | thoracic | shoulder | hamstring …
  side           text,                       -- left | right | bilateral
  movement       text,                       -- e.g. 'pigeon pose', 'overhead reach'
  finding        text not null,              -- description of the restriction/quality
  severity       int,                        -- 1..5 (5 = severely restricted)
  status         text not null default 'observation', -- observation | hypothesis | confirmed
  confidence     numeric not null default 0.7,
  first_observed timestamptz not null default now(),
  last_observed  timestamptz not null default now(),
  resolved_at    timestamptz,
  trend          text,                       -- improving | stable | worsening | unknown
  source         text not null default 'chat',
  notes          text,
  provenance     jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create table symptoms (
  id            uuid primary key default gen_random_uuid(),
  body_part     text not null,
  side          text,
  kind          text not null default 'pain', -- pain | pinch | tightness | ache | numbness | fatigue
  description   text not null,
  severity      int,                          -- 1..10
  status        text not null default 'active', -- active | monitoring | resolved
  session_id    uuid references workout_sessions(id),
  exercise_id   uuid references exercises(id),
  onset_at      timestamptz not null default now(),
  resolved_at   timestamptz,
  source        text not null default 'chat',
  confidence    numeric not null default 0.9,
  notes         text,
  provenance    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table injury_limitations (
  id            uuid primary key default gen_random_uuid(),
  description   text not null,
  body_part     text,
  side          text,
  -- movement patterns / exercises to avoid or modify
  restrictions  jsonb not null default '[]'::jsonb,
  severity      text not null default 'moderate', -- mild | moderate | severe
  status        text not null default 'active',   -- active | resolved
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  source        text not null default 'chat',
  notes         text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Nutrition
-- ---------------------------------------------------------------------------

create table food_references (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,                -- usda | openfoodfacts | custom
  provider_id   text not null,
  name          text not null,
  brand         text,
  barcode       text,
  per_100g      jsonb not null,               -- { kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g }
  serving       jsonb,                        -- { size_g, description }
  raw           jsonb not null default '{}'::jsonb,
  fetched_at    timestamptz not null default now(),
  unique (provider, provider_id)
);
create index on food_references (barcode);

create table meals (
  id            uuid primary key default gen_random_uuid(),
  eaten_at      timestamptz not null default now(),
  meal_type     text,                         -- breakfast | lunch | dinner | snack
  description   text,
  status        text not null default 'estimated', -- planned | estimated | confirmed | corrected
  photo_url     text,
  kcal          numeric not null default 0,   -- cached totals, recomputed from items
  protein_g     numeric not null default 0,
  carbs_g       numeric not null default 0,
  fat_g         numeric not null default 0,
  fiber_g       numeric,
  sugar_g       numeric,
  source        text not null default 'manual',   -- manual | text | voice | photo | barcode
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on meals (eaten_at desc);

create table meal_items (
  id                uuid primary key default gen_random_uuid(),
  meal_id           uuid not null references meals(id) on delete cascade,
  food_reference_id uuid references food_references(id),
  description       text not null,
  quantity          numeric,
  unit              text,                     -- oz | g | cup | item …
  grams             numeric,                  -- resolved weight in grams
  kcal              numeric not null default 0,
  protein_g         numeric not null default 0,
  carbs_g           numeric not null default 0,
  fat_g             numeric not null default 0,
  fiber_g           numeric,
  sugar_g           numeric,
  confidence        numeric not null default 0.8,
  estimation_method text not null default 'manual', -- vision | text | voice | barcode | search | manual
  corrected         boolean not null default false,
  correction_note   text,                     -- what the user corrected ("was 170g, actually 10 oz")
  provenance        jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table nutrition_targets (
  id                  uuid primary key default gen_random_uuid(),
  date                date unique,            -- null = standing default
  kcal                int not null,
  protein_g           int not null,
  carbs_g             int,
  fat_g               int,
  fiber_g             int,
  eating_window_start time,
  eating_window_end   time,
  rationale           text,
  source              text not null default 'coach',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table recipes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  servings      numeric not null default 1,
  ingredients   jsonb not null default '[]'::jsonb, -- [{description, grams, kcal, protein_g …}]
  instructions  text,
  per_serving   jsonb,                        -- { kcal, protein_g, carbs_g, fat_g }
  tags          text[] not null default '{}',
  source        text not null default 'coach',
  created_at    timestamptz not null default now()
);

create table shopping_lists (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null,
  -- [{ store, category, item, quantity, note, purchased }]
  items         jsonb not null default '[]'::jsonb,
  status        text not null default 'draft', -- draft | active | done
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Calendar & scheduling
-- ---------------------------------------------------------------------------

create table calendar_events (
  id            uuid primary key default gen_random_uuid(),
  external_id   text not null unique,
  calendar_id   text,
  title         text,
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  all_day       boolean not null default false,
  busy          boolean not null default true,
  raw           jsonb not null default '{}'::jsonb,
  synced_at     timestamptz not null default now()
);
create index on calendar_events (start_at);

create table calendar_plans (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null,
  -- proposed placement of workouts into calendar windows
  -- [{ workout_id, date, start, duration_min, rationale }]
  schedule      jsonb not null default '[]'::jsonb,
  status        text not null default 'proposed', -- proposed | confirmed | superseded
  reasoning     text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Coach intelligence: decisions, observations, reviews, outcomes
-- ---------------------------------------------------------------------------

create table coach_decisions (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,               -- daily_training | daily_focus | nutrition_target | reschedule | plan_change | meal_advice | weekly_plan
  decision      text not null,
  reasoning     text not null,
  context       jsonb not null default '{}'::jsonb, -- snapshot inputs the decision was based on
  status        text not null default 'proposed',   -- proposed | accepted | overridden | expired
  user_response text,
  outcome_note  text,                        -- filled in later: was it right in hindsight?
  made_at       timestamptz not null default now(),
  resolved_at   timestamptz
);
create index on coach_decisions (kind, made_at desc);

create table coach_observations (
  id             uuid primary key default gen_random_uuid(),
  category       text not null,              -- training | nutrition | recovery | mobility | behavior | energy_balance
  content        text not null,
  status         text not null default 'observation', -- observation | hypothesis | confirmed
  confidence     numeric not null default 0.6,
  evidence       jsonb not null default '[]'::jsonb,
  source         text not null default 'coach',
  superseded_by  uuid references coach_observations(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table expected_outcomes (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null,
  metric        text not null,               -- weight_change_lb | waist_change_in | strength_sessions | protein_days | sleep_avg_h | steps_avg | aerobic_min | boxing_sessions
  expected      jsonb not null,              -- { min, max, target, unit }
  notes         text,
  created_at    timestamptz not null default now(),
  unique (week_start, metric)
);

create table actual_outcomes (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null,
  metric        text not null,
  actual        jsonb not null,              -- { value, unit, detail }
  computed_at   timestamptz not null default now(),
  unique (week_start, metric)
);

create table weekly_reviews (
  id              uuid primary key default gen_random_uuid(),
  week_start      date not null unique,
  body            jsonb not null default '{}'::jsonb,
  training        jsonb not null default '{}'::jsonb,
  recovery        jsonb not null default '{}'::jsonb,
  nutrition       jsonb not null default '{}'::jsonb,
  movement        jsonb not null default '{}'::jsonb,
  execution_score int,                       -- 0..100: did I follow the plan?
  outcome_score   int,                       -- 0..100: did the body respond as predicted?
  summary         text,
  coach_decision  text,                      -- maintain | adjust_assumptions | focus_adherence
  created_at      timestamptz not null default now()
);

-- Personal energy model: learned energy-balance response
create table energy_model_estimates (
  id                  uuid primary key default gen_random_uuid(),
  window_start        date not null,
  window_end          date not null,
  avg_intake_kcal     numeric,
  avg_steps           numeric,
  avg_training_min    numeric,
  weight_change_lb_wk numeric,
  estimated_tdee_kcal numeric,
  confidence          numeric not null default 0.3,
  notes               text,
  computed_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Progress photos
-- ---------------------------------------------------------------------------

create table progress_photos (
  id            uuid primary key default gen_random_uuid(),
  taken_at      timestamptz not null default now(),
  pose          text,                        -- front | side | back
  url           text not null,               -- storage path or data ref
  notes         text,
  context       jsonb not null default '{}'::jsonb, -- weight/waist at time of photo
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Chat (persisted for UX; NEVER the source of truth)
-- ---------------------------------------------------------------------------

create table chat_messages (
  id            uuid primary key default gen_random_uuid(),
  role          text not null,               -- user | assistant
  content       text not null,
  modality      text not null default 'text', -- text | voice | photo
  attachments   jsonb not null default '[]'::jsonb,
  -- structured records the extractor created from this message (audit trail)
  extracted     jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index on chat_messages (created_at desc);

-- ---------------------------------------------------------------------------
-- Ingestion provenance
-- ---------------------------------------------------------------------------

create table health_import_batches (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'apple_health',
  payload_hash  text,
  item_count    int not null default 0,
  accepted      int not null default 0,
  skipped       int not null default 0,
  errors        jsonb not null default '[]'::jsonb,
  imported_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notifications (restrained)
-- ---------------------------------------------------------------------------

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,               -- weigh_in_missing | workout_soon | reschedule_needed | protein_behind | waist_due | review_ready
  title         text not null,
  body          text,
  due_at        timestamptz not null default now(),
  seen_at       timestamptz,
  dismissed_at  timestamptz,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
