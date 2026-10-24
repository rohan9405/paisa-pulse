"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { PointerScrubSession } from "@/lib/pointerScrub";

/** Pointer capture keeps a drag alive while selection rerenders the chart.
 * Hit testing uses coordinates because captured events target the container.
 * Only enabled cells belonging to this container may be selected.
 */
export function usePointerScrub(onSelect: (value: string) => void) {
  const session = useRef(new PointerScrubSession());
  const hit = (event: ReactPointerEvent<HTMLDivElement>) => {
    const cell = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>("[data-scrub-value]");
    return cell && event.currentTarget.contains(cell) && !cell.disabled ? cell.dataset.scrubValue : undefined;
  };
  const select = (event: ReactPointerEvent<HTMLDivElement>) => {
    const value = hit(event);
    if (value && session.current.select(event.pointerId, value)) onSelect(value);
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!session.current.owns(event.pointerId)) return;
    session.current.end(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (!hit(event) || !session.current.begin(event.pointerId, event.isPrimary, event.button)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      select(event);
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      if (session.current.owns(event.pointerId)) select(event);
    },
    onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      if (session.current.owns(event.pointerId)) select(event);
      end(event);
    },
    onPointerCancel: end,
    onLostPointerCapture: end,
  };
}
