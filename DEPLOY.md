# Get Rocko on your phone (~15 minutes, no laptop required)

## 1. Database — Supabase (free)

1. [supabase.com](https://supabase.com) → New project (any name, any region near you).
2. When it finishes provisioning: **Connect** (top bar) → **Connection String** →
   copy the **URI** under "Transaction pooler" and replace `[YOUR-PASSWORD]`
   with the database password you chose.
   It looks like `postgresql://postgres.xxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres`.

## 2. App — Vercel (free)

1. [vercel.com](https://vercel.com) → Add New → Project → Import
   `logic25/ai-health-coach`.
2. Before deploying, add **Environment Variables**:

   | name | value |
   | --- | --- |
   | `DATABASE_URL` | the Supabase URI from step 1 |
   | `ANTHROPIC_API_KEY` | from [console.anthropic.com](https://console.anthropic.com) — powers chat, photo meals, voice parsing, workout reasoning |
   | `HEALTH_IMPORT_TOKEN` | any long random string you make up (it's your setup + Apple Health password) |
   | `COACH_TZ` | `America/New_York` |
   | `USDA_API_KEY` | optional — free key from [fdc.nal.usda.gov](https://fdc.nal.usda.gov/api-key-signup.html); `DEMO_KEY` works to start |

3. Deploy. You'll get a URL like `https://ai-health-coach-xxx.vercel.app`.

## 3. Initialize the database — one tap

In your phone browser, visit:

```
https://<your-app>.vercel.app/api/admin/setup?token=<HEALTH_IMPORT_TOKEN>
```

You should see `"ok": true` with 52 exercises seeded. Safe to re-run anytime.

## 4. Install on the home screen

Open the app URL in Safari → Share → **Add to Home Screen**. It launches
full-screen with the kettlebell icon like a native app.

## 5. First test drive

1. **Today** → Morning brief.
2. **Train** → Build today's workout → open it → Start.
3. Enable hands-free and say: **"Rocko, ten reps at thirty-five."**
4. Photograph a meal on **Eat** — or use *"How much of this should I eat?"*
   before you eat it.
5. Log tomorrow's weight when you wake up.

## Later (optional)

- **Google Calendar**: create OAuth credentials (Calendar API), add
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI=https://<your-app>.vercel.app/api/calendar/callback`
  in Vercel, redeploy, then visit `/api/calendar/auth` once.
- **Apple Health**: point an exporter app (e.g. Health Auto Export) at
  `POST https://<your-app>.vercel.app/api/health/import` with header
  `Authorization: Bearer <HEALTH_IMPORT_TOKEN>` — payload format in
  `docs/apple-health-schema.md`.
- **Voice note**: hands-free wake-word listening works best in Chrome on
  Android and Safari on iOS 17+; the tap-to-talk mic works everywhere.
