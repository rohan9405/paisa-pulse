"use client";

import { useEffect } from "react";
import { getDB } from "@/data/db";
import { ensureRules } from "@/data/repo";
import { syncSms } from "@/data/providers/sms";
import { toISTKey } from "@/lib/dates";
import { widgetSnapshot } from "@/lib/widget";

declare global {
  interface Window { PaisaWidgetJob?: { finish(ok: boolean): void }; }
}

/** Local Android job entry point; never renders an activity or opens the app UI. */
export default function WidgetSyncPage() {
  useEffect(() => {
    if (!window.PaisaWidgetJob || !window.PaisaWidget) return;
    let active = true;
    (async () => {
      let ok = false;
      try {
        const db = getDB("personal");
        await db.open();
        if (!(await db.profile.get("me"))) {
          window.PaisaWidget!.clear();
          ok = true;
          return;
        }
        await ensureRules(db);
        await syncSms(db);
        const [profile, plans, txns] = await Promise.all([db.profile.get("me"), db.plans.toArray(), db.txns.toArray()]);
        if (active && profile) window.PaisaWidget!.update(JSON.stringify({
          ...widgetSnapshot({ profile, plans, txns, today: toISTKey() }), updatedAt: Date.now(),
        }));
        ok = true;
      } finally {
        if (active) window.PaisaWidgetJob?.finish(ok);
      }
    })().catch(() => {});
    return () => { active = false; };
  }, []);
  return null;
}
