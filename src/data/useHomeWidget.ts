"use client";

import { useEffect, useRef } from "react";
import { widgetSnapshot } from "@/lib/widget";
import type { AppData } from "./store";
import type { AppMode, DateKey } from "@/lib/types";

declare global {
  interface Window { PaisaWidget?: { update(snapshot: string): void; clear(): void; canPin(): boolean; requestPin(): void }; }
}

/** Demo data never reaches the launcher. Avoid republishing on no-op SMS checks. */
export function useHomeWidget(data: AppData | undefined, mode: AppMode | null, today: DateKey) {
  const last = useRef("");
  useEffect(() => {
    const bridge = window.PaisaWidget;
    if (!bridge || mode !== "personal" || !data) return;
    if (!data.profile) {
      bridge.clear();
      last.current = "";
      return;
    }
    const snapshot = widgetSnapshot({ ...data, profile: data.profile, today });
    const key = JSON.stringify(snapshot);
    if (last.current === key) return;
    bridge.update(JSON.stringify({ ...snapshot, updatedAt: Date.now() }));
    last.current = key;
  }, [data, mode, today]);
}
