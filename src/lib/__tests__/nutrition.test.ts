import { describe, expect, it } from "vitest";
import { scaleNutrition, toGrams, OZ_TO_G } from "../nutrition/providers";

describe("toGrams", () => {
  it("converts oz to grams", () => {
    expect(toGrams(10, "oz")).toBeCloseTo(283.5, 0);
  });
  it("passes grams through", () => {
    expect(toGrams(170, "g")).toBe(170);
  });
  it("returns null for food-specific units (cup)", () => {
    expect(toGrams(1, "cup")).toBeNull();
  });
});

describe("scaleNutrition", () => {
  const chickenPer100g = { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6, fiber_g: 0, sugar_g: 0 };

  it("scales the 170g -> 10oz correction example correctly", () => {
    const before = scaleNutrition(chickenPer100g, 170);
    expect(before.kcal).toBe(281);
    expect(before.protein_g).toBeCloseTo(52.7, 1);

    const after = scaleNutrition(chickenPer100g, 10 * OZ_TO_G);
    expect(after.kcal).toBe(468);
    expect(after.protein_g).toBeCloseTo(87.9, 1);
  });

  it("keeps null micronutrients null", () => {
    const r = scaleNutrition({ kcal: 100, protein_g: 10, carbs_g: 5, fat_g: 2, fiber_g: null, sugar_g: null }, 200);
    expect(r.fiber_g).toBeNull();
    expect(r.sugar_g).toBeNull();
  });
});
