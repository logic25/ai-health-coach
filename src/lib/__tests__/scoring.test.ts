import { describe, expect, it } from "vitest";
import { executionScore, outcomeScore, coachDecisionFor, WeekAggregates } from "../scoring";

const goodWeek: WeekAggregates = {
  weekStart: "2026-08-03", weekEnd: "2026-08-10",
  avgWeight: 189.8, prevAvgWeight: 190.8, weightChange: -1.0,
  latestWaist: 38.25, prevWaist: 38.5, waistChange: -0.25,
  plannedWorkouts: 5, completedWorkouts: 5,
  strengthSessions: 4, boxingSessions: 1, aerobicMin: 95,
  avgSessionRpe: 7.2, avgSleepH: 7.3, avgHrv: 78, avgRhr: 57, avgSoreness: 3,
  avgKcal: 1980, avgProtein: 188, proteinDays: 6, kcalAdherenceDays: 6,
  loggedDays: 7, stepsAvg: 6800, measurementDays: 6,
};

describe("executionScore", () => {
  it("high adherence scores high", () => {
    const { score } = executionScore(goodWeek);
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it("low adherence scores low", () => {
    const { score } = executionScore({
      ...goodWeek,
      completedWorkouts: 1, proteinDays: 1, kcalAdherenceDays: 1,
      loggedDays: 2, stepsAvg: 2500, measurementDays: 1,
    });
    expect(score).toBeLessThan(45);
  });
});

describe("outcomeScore", () => {
  const expected = {
    weight_change_lb: { min: -1.2, max: -0.7 },
    waist_change_in: { max: 0 },
    sleep_avg_h: { target: 7 },
    aerobic_min: { target: 90 },
  };

  it("body responding as predicted scores high", () => {
    const { score } = outcomeScore(goodWeek, expected);
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it("weight gain against a loss prediction scores low on weight", () => {
    const { parts } = outcomeScore({ ...goodWeek, weightChange: 0.8 }, expected);
    expect(parts.weight).toBeLessThan(0.2);
  });

  it("ignores metrics with no data instead of failing", () => {
    const { score } = outcomeScore(
      { ...goodWeek, weightChange: null, waistChange: null }, expected);
    expect(score).toBeGreaterThan(0);
  });
});

describe("coachDecisionFor (spec logic)", () => {
  it("high execution + good outcome => maintain", () => {
    expect(coachDecisionFor(90, 85).decision).toBe("maintain");
  });
  it("high execution + poor outcome => adjust assumptions", () => {
    expect(coachDecisionFor(90, 40).decision).toBe("adjust_assumptions");
  });
  it("low execution + poor outcome => focus adherence, not plan change", () => {
    expect(coachDecisionFor(40, 30).decision).toBe("focus_adherence");
  });
});
