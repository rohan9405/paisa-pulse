"use client";

import { useEffect } from "react";
import { useAppData } from "@/data/store";
import { useRemoteConfig } from "@/data/remoteConfigLoader";

export function Appearance() {
  const data = useAppData();
  const config = useRemoteConfig();
  const lowercase = data?.profile?.prefs?.lowercase ?? config.defaults.lowercase;
  useEffect(() => {
    document.documentElement.dataset.lowercase = String(lowercase);
    return () => { delete document.documentElement.dataset.lowercase; };
  }, [lowercase]);
  return null;
}
