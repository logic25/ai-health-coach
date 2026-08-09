import { describe, expect, it } from "vitest";
import { importPayloadSchema } from "../applehealth";

describe("importPayloadSchema", () => {
  it("accepts a full realistic payload", () => {
    const payload = {
      source: "apple_health",
      device: "iPhone",
      samples: [
        { type: "weight", value: 86.6, unit: "kg", date: "2026-08-09" },
        { type: "resting_heart_rate", value: 58, date: "2026-08-09" },
        { type: "hrv", value: 77, date: "2026-08-09" },
        {
          type: "sleep", date: "2026-08-09",
          start: "2026-08-09T03:10:00Z", end: "2026-08-09T11:00:00Z",
          stages: { core: 240, deep: 55, rem: 95, awake: 20 },
        },
        { type: "steps", value: 7412, date: "2026-08-08" },
        { type: "active_calories", value: 610, date: "2026-08-08" },
        { type: "distance", value: 5.1, unit: "km", date: "2026-08-08" },
      ],
      workouts: [
        {
          external_id: "hk-uuid-1", activity_type: "Boxing",
          start: "2026-08-08T21:00:00Z", end: "2026-08-08T21:45:00Z",
          duration_min: 45, active_kcal: 420, avg_heart_rate: 148,
        },
      ],
    };
    const parsed = importPayloadSchema.parse(payload);
    expect(parsed.samples).toHaveLength(7);
    expect(parsed.workouts).toHaveLength(1);
  });

  it("rejects unknown sample types", () => {
    expect(() =>
      importPayloadSchema.parse({ samples: [{ type: "blood_glucose", value: 90, date: "2026-08-09" }] })
    ).toThrow();
  });

  it("defaults missing arrays", () => {
    const parsed = importPayloadSchema.parse({});
    expect(parsed.samples).toEqual([]);
    expect(parsed.workouts).toEqual([]);
  });
});
