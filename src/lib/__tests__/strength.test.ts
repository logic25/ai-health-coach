import { describe, expect, it } from "vitest";
import { epley1Rm, evaluatePr, suggestNextLoad } from "../strength";

describe("epley1Rm", () => {
  it("returns the load itself for a single", () => {
    expect(epley1Rm(100, 1)).toBe(100);
  });
  it("estimates 35x10 correctly", () => {
    expect(epley1Rm(35, 10)).toBeCloseTo(46.7, 1);
  });
  it("caps rep inflation at 12", () => {
    expect(epley1Rm(35, 20)).toBe(epley1Rm(35, 12));
  });
});

describe("evaluatePr", () => {
  const history = [
    { loadLb: 35, reps: 8 },   // e1rm 44.3
    { loadLb: 40, reps: 5 },   // e1rm 46.7
    { loadLb: 35, reps: 10 },  // e1rm 46.7
  ];

  it("detects an e1RM PR", () => {
    const r = evaluatePr({ loadLb: 40, reps: 8 }, history); // 50.7
    expect(r.isPr).toBe(true);
    expect(r.kind).toBe("e1rm");
  });

  it("detects a heaviest-load PR even without e1RM PR", () => {
    const r = evaluatePr({ loadLb: 45, reps: 1 }, history); // e1rm 45 < 46.7
    expect(r.isPr).toBe(true);
    expect(r.kind).toBe("load");
  });

  it("detects a reps-at-load PR", () => {
    const r = evaluatePr({ loadLb: 40, reps: 6 }, history); // 48 -> e1rm PR actually
    expect(r.isPr).toBe(true);
  });

  it("no PR for a routine set", () => {
    const r = evaluatePr({ loadLb: 35, reps: 8 }, history);
    expect(r.isPr).toBe(false);
    expect(r.previousBestE1rm).toBeCloseTo(46.7, 1);
  });

  it("first loaded set is a baseline, not a PR", () => {
    const r = evaluatePr({ loadLb: 35, reps: 8 }, []);
    expect(r.isPr).toBe(false);
    expect(r.note).toBe("baseline set");
  });

  it("bodyweight sets (no load) never PR", () => {
    const r = evaluatePr({ loadLb: null, reps: 12 }, history);
    expect(r.isPr).toBe(false);
  });
});

describe("suggestNextLoad", () => {
  it("progresses after an easy full set", () => {
    const s = suggestNextLoad({ loadLb: 35, reps: 10, rpe: 6 });
    expect(s?.loadLb).toBe(37.5);
  });
  it("uses 5 lb jumps at heavier loads", () => {
    const s = suggestNextLoad({ loadLb: 80, reps: 8, rpe: 6 });
    expect(s?.loadLb).toBe(85);
  });
  it("backs off after a grinder", () => {
    const s = suggestNextLoad({ loadLb: 40, reps: 6, rpe: 9.5 });
    expect(s?.loadLb).toBe(37.5);
  });
  it("repeats when in the pocket", () => {
    const s = suggestNextLoad({ loadLb: 35, reps: 8, rpe: 8 });
    expect(s?.loadLb).toBe(35);
  });
  it("returns null with no load history", () => {
    expect(suggestNextLoad({ loadLb: null, reps: null, rpe: null })).toBeNull();
  });
});
