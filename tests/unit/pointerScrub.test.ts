import { describe, expect, it } from "vitest";
import { PointerScrubSession } from "@/lib/pointerScrub";

describe("pointer scrub sessions", () => {
  it("keeps selecting new cells during one held pointer and skips duplicate updates", () => {
    const s = new PointerScrubSession();
    expect(s.begin(4, true, 0)).toBe(true);
    expect(s.select(4, "2026-10-20")).toBe(true);
    expect(s.select(4, "2026-10-20")).toBe(false);
    expect(s.select(4, "2026-10-21")).toBe(true);
    expect(s.select(4, "2026-10-20")).toBe(true);
    s.end(4);
    expect(s.select(4, "2026-10-22")).toBe(false);
  });
  it("ignores other fingers and secondary buttons without interrupting the first", () => {
    const s = new PointerScrubSession();
    expect(s.begin(2, false, 0)).toBe(false);
    expect(s.begin(2, true, 2)).toBe(false);
    expect(s.begin(1, true, 0)).toBe(true);
    expect(s.begin(2, true, 0)).toBe(false);
    expect(s.select(2, "other")).toBe(false);
    s.end(2);
    expect(s.select(1, "original")).toBe(true);
  });
  it("releases on end/cancel and allows the same date in a new gesture", () => {
    const s = new PointerScrubSession();
    s.begin(1, true, 0); s.select(1, "day"); s.end(1);
    expect(s.owns(1)).toBe(false);
    expect(s.begin(3, true, 0)).toBe(true);
    expect(s.select(3, "day")).toBe(true);
  });
});
