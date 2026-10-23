"use client";

import { useEffect, useState } from "react";
import { compareVersions } from "@/lib/remoteConfig";
import { APP_VERSION, useRemoteConfig } from "@/data/remoteConfigLoader";
import { cx } from "./ui";

const DISMISSED_KEY = "drip:dismissed-announcement";

/** Announcement and "new version" banners from the remote config, shown on Today. */
export function Notices() {
  const { announcement, update } = useRemoteConfig();
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY));
    } catch {
      /* show it */
    }
  }, []);
  const dismiss = (id: string) => {
    setDismissed(id);
    try {
      window.localStorage.setItem(DISMISSED_KEY, id);
    } catch {
      /* hidden for this session only */
    }
  };
  const showUpdate = update && compareVersions(APP_VERSION, update.latestVersion) < 0;
  const showAnnouncement = announcement && dismissed !== announcement.id;
  if (!showUpdate && !showAnnouncement) return null;

  return (
    <div className="mb-3 space-y-2" data-testid="notices">
      {showUpdate && (
        <a href={update.url} target="_blank" rel="noreferrer" className="card flex items-center justify-between gap-3 border-lime/30 bg-lime/[0.07] text-sm" data-testid="update-notice">
          <span>
            ⬆️ <b>drip {update.latestVersion}</b> is available{update.message ? ` · ${update.message}` : ""}
          </span>
          <span className="shrink-0 font-semibold text-lime">Get it →</span>
        </a>
      )}
      {showAnnouncement && (
        <div className={cx("card flex items-start justify-between gap-3 text-sm", announcement.tone === "warn" ? "border-amber/30 bg-amber/[0.07] text-amber" : "border-sky/30 bg-sky/[0.07] text-sky")} data-testid="announcement">
          <span>
            {announcement.text}{" "}
            {announcement.link && (
              <a href={announcement.link} target="_blank" rel="noreferrer" className="font-semibold underline">
                More
              </a>
            )}
          </span>
          <button className="shrink-0 text-xs opacity-70" onClick={() => dismiss(announcement.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
