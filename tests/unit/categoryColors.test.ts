import { expect, it } from "vitest";
import { CATEGORIES } from "@/lib/categorize";
import { CATEGORY_COLORS, categoryColor } from "@/lib/categoryColors";

it("assigns every built-in category a unique permanent colour outside the status palette", () => {
  const colors = CATEGORIES.map(categoryColor);
  expect(new Set(colors).size).toBe(CATEGORIES.length);
  expect(categoryColor("Other")).not.toBe(categoryColor("Bills"));
  for (const color of colors) expect(["#a78bfa", "#c6ff3d", "#ff6b6b", "#ffc857"]).not.toContain(color.toLowerCase());
  expect([...CATEGORIES].reverse().map(categoryColor).reverse()).toEqual(colors);
  expect(categoryColor("Unknown")).toBe(CATEGORY_COLORS.Other);
  expect(categoryColor("toString")).toBe(CATEGORY_COLORS.Other);
});
