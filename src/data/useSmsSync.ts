"use client";

import { useEffect } from "react";
import type { FinanceDB } from "./db";
import { smsBridge, syncSms } from "./providers/sms";

const EVERY_MS = 60_000;

/**
 * Keeps bank SMS flowing in with no user action: on open, whenever the Android
 * app comes back to the foreground or SMS permission is granted, and every
 * minute while open. No-op outside the Android app. Pass null to disable.
 */
export function useSmsSync(db: FinanceDB | null) {
  useEffect(() => {
    if (!db || !smsBridge()) return;
    const run = () => {
      syncSms(db).catch((e) => console.error("SMS sync failed", e));
    };
    run();
    const id = window.setInterval(run, EVERY_MS);
    window.addEventListener("paisa-resume", run);
    window.addEventListener("paisa-sms-permission", run);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("paisa-resume", run);
      window.removeEventListener("paisa-sms-permission", run);
    };
  }, [db]);
}
