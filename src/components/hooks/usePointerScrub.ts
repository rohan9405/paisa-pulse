"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { haptic } from "@/data/device";
import { PointerScrubSession } from "@/lib/pointerScrub";

/** Touch surfaces use pan-y: vertical gestures belong to page scrolling.
 * Delay selection until horizontal intent (or a tap) so scrolling never picks
 * a date first. Mouse dragging remains immediate in either direction.
 */
export function usePointerScrub(onSelect: (value: string) => void) {
  const session = useRef(new PointerScrubSession());
  const gesture = useRef({ x: 0, y: 0, touch: false, horizontal: false });
  const hit = (event: ReactPointerEvent<HTMLDivElement>) => {
    const cell = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>("[data-scrub-value]");
    return cell && event.currentTarget.contains(cell) && !cell.disabled ? cell.dataset.scrubValue : undefined;
  };
  const select = (event: ReactPointerEvent<HTMLDivElement>) => {
    const value = hit(event);
    if (value && session.current.select(event.pointerId, value)) {
      haptic("tap");
      onSelect(value);
    }
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!session.current.owns(event.pointerId)) return;
    session.current.end(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    "data-scrub-surface": true,
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (!hit(event) || !session.current.begin(event.pointerId, event.isPrimary, event.button)) return;
      gesture.current = { x: event.clientX, y: event.clientY, touch: event.pointerType !== "mouse", horizontal: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      if (!gesture.current.touch) select(event);
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      if (!session.current.owns(event.pointerId)) return;
      const g = gesture.current;
      if (g.touch && !g.horizontal) {
        const dx = Math.abs(event.clientX - g.x), dy = Math.abs(event.clientY - g.y);
        if (Math.max(dx, dy) < 8) return;
        if (dy > dx) { end(event); return; }
        g.horizontal = true;
      }
      select(event);
    },
    onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      if (session.current.owns(event.pointerId)) select(event);
      end(event);
    },
    onPointerCancel: end,
    onLostPointerCapture: end,
  };
}
