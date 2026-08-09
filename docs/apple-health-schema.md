# Apple Health Import — JSON Schema

`POST /api/health/import`
Header: `Authorization: Bearer <HEALTH_IMPORT_TOKEN>` (set in env).

Development never depends on direct HealthKit access — any bridge (iOS Shortcut,
Health Auto Export app, or a custom HealthKit app) that can POST JSON works.
The endpoint is idempotent: daily metrics upsert by `(date, kind, source)` and
workouts dedupe by `external_id`, so re-sending overlapping windows is safe.

## Payload

```jsonc
{
  "source": "apple_health",          // optional, default "apple_health"
  "device": "iPhone 16",             // optional
  "exported_at": "2026-08-09T12:00:00Z", // optional
  "samples": [ Sample, ... ],
  "workouts": [ Workout, ... ]
}
```

### Sample

```jsonc
{
  "type": "weight",        // required, see supported types below
  "value": 86.6,           // number; required for all types except "sleep" with stages
  "unit": "kg",            // optional; see conversions
  "date": "2026-08-09",    // required — the LOCAL day the sample belongs to
  "start": "2026-08-09T11:05:00Z",  // optional ISO timestamp
  "end":   "2026-08-09T11:06:00Z",  // optional
  "stages": {              // sleep only, minutes by stage
    "in_bed": 480, "core": 240, "deep": 55, "rem": 95, "awake": 20
  }
}
```

| type                 | value                | unit handling                     | stored as |
| -------------------- | -------------------- | --------------------------------- | --------- |
| `weight`             | body mass            | `kg` converted to lb; default lb  | measurements.weight (1/day from AH) |
| `body_fat_pct`       | percent              | pct                               | measurements.body_fat_pct |
| `resting_heart_rate` | bpm                  | bpm                               | recovery_metrics.resting_hr_bpm |
| `hrv`                | SDNN ms              | ms                                | recovery_metrics.hrv_ms |
| `sleep`              | total asleep minutes (or omit and send `stages`) | min | recovery_metrics.sleep_* (duration, deep, rem, core, awake) |
| `steps`              | count                | count                             | activity_metrics.steps |
| `active_calories`    | kcal                 | kcal                              | activity_metrics.active_kcal |
| `exercise_minutes`   | minutes              | min                               | activity_metrics.exercise_min |
| `distance`           | mi (or `"unit":"km"` converted) | mi                     | activity_metrics.distance_mi |
| `vo2_max`            | ml/kg/min            |                                   | recovery_metrics.vo2_max |
| `respiratory_rate`   | breaths/min          |                                   | recovery_metrics.respiratory_rate |

### Workout

```jsonc
{
  "external_id": "8A5F0C…",           // required — HealthKit workout UUID (dedupe key)
  "activity_type": "Boxing",          // HK activity name; "Boxing"/"Walking"/etc drive aerobic classification
  "start": "2026-08-08T21:00:00Z",    // required ISO
  "end":   "2026-08-08T21:45:00Z",    // required ISO
  "duration_min": 45,                 // required
  "active_kcal": 420,                 // optional
  "avg_heart_rate": 148,              // optional
  "max_heart_rate": 171,              // optional
  "distance_mi": 0,                   // optional
  "heart_rate_series": [ { "t": "2026-08-08T21:01:00Z", "bpm": 132 }, ... ] // optional
}
```

Workouts land in `workout_sessions` with `source='apple_health'` and the full
payload in `raw` (future CV/HR analysis attaches there too).

## Response

```json
{ "batchId": "uuid", "accepted": 6, "skipped": 0, "errors": [{ "index": 3, "error": "…" }] }
```

Every import creates a `health_import_batches` row (provenance); each record
stores the batch id in its `provenance`/`raw` field. After import, today's
recovery score is recomputed automatically.

## Example (curl)

```bash
curl -X POST "$APP/api/health/import" \
  -H "Authorization: Bearer $HEALTH_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"samples":[{"type":"hrv","value":77,"date":"2026-08-09"}]}'
```
