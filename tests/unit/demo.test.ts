import { describe, expect, it } from "vitest";
import { computeLedger } from "@/lib/budget";
import { generateDemoData } from "@/data/providers/demo";

describe("demo provider", () => {
  it.each(["2026-10-21", "2026-03-01", "2024-02-29", "2026-12-31"])("generates labelled, plausible fictional data for %s", (today) => {
    const { profile, plan, txns } = generateDemoData(today, 0);
    expect(txns.length).toBeGreaterThan(20);
    expect(txns.every((t) => t.source.providerId === "demo" && /fictional/i.test(t.source.raw ?? ""))).toBe(true);
    expect(txns.every((t) => t.date >= profile.trackingStart && t.date <= today)).toBe(true);
    expect(txns.every((t) => Number.isSafeInteger(t.amountPaise) && t.amountPaise > 0)).toBe(true);
    const l = computeLedger({ plans: [plan], profile, txns, today });
    // Realistic: neither wildly under nor over budget.
    expect(Math.abs(l.availablePaise)).toBeLessThan(l.totalAllocatedPaise * 0.35);
  });
});
