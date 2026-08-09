import { describe, expect, it } from "vitest";
import { tzOffsetMinutes } from "../calendar";
import { weekStartOf, addDays } from "../db";
import { deterministicWorkout } from "../programming";

describe("tzOffsetMinutes", () => {
  it("returns -240 for America/New_York in summer (EDT)", () => {
    expect(tzOffsetMinutes(new Date("2026-08-09T12:00:00Z"), "America/New_York")).toBe(-240);
  });
  it("returns -300 for America/New_York in winter (EST)", () => {
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-300);
  });
});

describe("week helpers", () => {
  it("weekStartOf returns Monday", () => {
    expect(weekStartOf("2026-08-09")).toBe("2026-08-03"); // Sunday -> prior Monday
    expect(weekStartOf("2026-08-03")).toBe("2026-08-03"); // Monday stays
  });
  it("addDays crosses months", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
  });
});

describe("deterministicWorkout", () => {
  const lib = [
    { slug: "goblet-squat", movement_pattern: "squat", difficulty: 2 },
    { slug: "rdl", movement_pattern: "hinge", difficulty: 3 },
    { slug: "split-squat", movement_pattern: "lunge", difficulty: 3 },
    { slug: "glute-bridge", movement_pattern: "glute", difficulty: 1 },
    { slug: "deadbug", movement_pattern: "core_anti_extension", difficulty: 1 },
    { slug: "pigeon", movement_pattern: "hip_mobility", difficulty: 2 },
    { slug: "heavy-thing", movement_pattern: "squat", difficulty: 5 },
  ];

  it("builds a lower/core session from matching patterns", () => {
    const w = deterministicWorkout(lib, "lower_core", "green");
    const slugs = w.exercises.map((e) => e.slug);
    expect(slugs).toContain("goblet-squat");
    expect(slugs).toContain("pigeon");
    expect(w.duration_min).toBeGreaterThanOrEqual(30);
    expect(w.duration_min).toBeLessThanOrEqual(45);
  });

  it("reduces volume and difficulty on yellow recovery", () => {
    const w = deterministicWorkout(lib, "lower_core", "yellow");
    const strengthSets = w.exercises.find((e) => e.slug === "goblet-squat")?.sets;
    expect(strengthSets).toBe(2);
    expect(w.exercises.map((e) => e.slug)).not.toContain("heavy-thing");
  });

  it("never selects difficulty-5 exercises even on green", () => {
    const w = deterministicWorkout(lib, "lower_core", "green");
    expect(w.exercises.map((e) => e.slug)).not.toContain("heavy-thing");
  });
});
