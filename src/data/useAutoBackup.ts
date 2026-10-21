"use client";

import { useEffect } from "react";
import type { AppMode } from "@/lib/types";
import type { FinanceDB } from "./db";
import { backupNow, filesBridge } from "./backup";

const MIN_GAP_MS = 10 * 60_000;

/**
 * Backs up personal data on open and whenever the app comes back to the
 * foreground (at most every 10 minutes). Today's file is overwritten, so the
 * folder holds one backup per day. No-op outside the Android app.
 */
export function useAutoBackup(db: FinanceDB | null, mode: AppMode | null) {
  useEffect(() => {
    if (!db || mode !== "personal" || !filesBridge()) return;
    let last = 0;
    const run = () => {
      if (Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      backupNow(db, mode).catch((e) => console.error("Backup failed", e));
    };
    // Give the first SMS sync a moment so the backup includes it.
    const first = window.setTimeout(run, 5_000);
    window.addEventListener("paisa-resume", run);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("paisa-resume", run);
    };
  }, [db, mode]);
}
