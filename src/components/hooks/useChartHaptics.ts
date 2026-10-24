"use client";

import { useRef } from "react";
import { haptic } from "@/data/device";

/** Recharts sends mouse and touch movement through onMouseMove. Tick only
 * when the inspected date changes, rather than on every pixel of movement. */
export function useChartHaptics() {
  const last = useRef<number | null>(null);
  const inspect = (state: { activeTooltipIndex?: number; isTooltipActive?: boolean } | null) => {
    const index = state?.activeTooltipIndex;
    if (state?.isTooltipActive === false || index === undefined || index < 0) return;
    if (index !== last.current) { last.current = index; haptic("tap"); }
  };
  return { onMouseMove: inspect, onMouseDown: inspect, onMouseLeave: () => { last.current = null; } };
}
