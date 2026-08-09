import { describe, expect, it } from "vitest";
import { computeRecoveryScore } from "../recovery";

describe("computeRecoveryScore", () => {
  it("scores a well-recovered day green", () => {
    const r = computeRecoveryScore({
      sleepMin: 470, // 7h50
      hrvMs: 80,
      hrvBaseline: 77,
      rhrBpm: 56,
      rhrBaseline: 58,
      soreness: 2,
      yesterdaySessionRpe: 6,
    });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.band).toBe("green");
  });

  it("scores a rough night red/yellow", () => {
    const r = computeRecoveryScore({
      sleepMin: 320, // 5h20
      hrvMs: 52,
      hrvBaseline: 77,
      rhrBpm: 66,
      rhrBaseline: 58,
      soreness: 7,
      yesterdaySessionRpe: 9,
    });
    expect(r.score).toBeLessThan(50);
    expect(r.band).toBe("red");
  });

  it("returns neutral 70 with no data", () => {
    const r = computeRecoveryScore({
      sleepMin: null, hrvMs: null, hrvBaseline: null,
      rhrBpm: null, rhrBaseline: null, soreness: null, yesterdaySessionRpe: null,
    });
    expect(r.score).toBe(70);
    expect(r.band).toBe("green");
  });

  it("uses only available components (sleep-only)", () => {
    const r = computeRecoveryScore({
      sleepMin: 480, hrvMs: null, hrvBaseline: null,
      rhrBpm: null, rhrBaseline: null, soreness: null, yesterdaySessionRpe: null,
    });
    expect(r.score).toBe(100);
  });
});
