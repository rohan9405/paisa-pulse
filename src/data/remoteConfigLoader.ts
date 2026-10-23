"use client";

/**
 * Downloads the remote config (see backend/) and keeps the last good copy on
 * the device. Download-only: a plain GET with no cookies, no identifiers and
 * no data about you. Offline, or if the server sends something invalid, the
 * app keeps using its cached copy (or the built-in defaults).
 */
import { useSyncExternalStore } from "react";
import { type RemoteConfig, getConfig, parseRemoteConfig, setConfig, subscribeConfig } from "@/lib/remoteConfig";

/** Set at build time (android/build.py reads it from android/local.json). Empty = remote config off. */
export const CONFIG_URL = process.env.NEXT_PUBLIC_CONFIG_URL ?? "";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
const CACHE_KEY = "drip:remote-config";

/** Apply the cached config, if any. Call before the first render that needs it. */
export function loadCachedConfig() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) setConfig(parseRemoteConfig(JSON.parse(raw)).config);
  } catch {
    /* no cache: defaults */
  }
}

let inflight: Promise<boolean> | null = null;

/** Fetch the latest config. Resolves true if it changed. Never throws. */
export function refreshConfig(): Promise<boolean> {
  if (!CONFIG_URL || typeof fetch === "undefined") return Promise.resolve(false);
  inflight ??= (async () => {
    try {
      const res = await fetch(CONFIG_URL, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) return false;
      const json: unknown = await res.json();
      const { config, errors } = parseRemoteConfig(json);
      if (errors.length) console.warn("Remote config: some fields were ignored", errors);
      if (config.version === getConfig().version) return false;
      setConfig(config);
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(json));
      } catch {
        /* cache is best-effort */
      }
      window.dispatchEvent(new Event("drip-config"));
      return true;
    } catch {
      return false; // offline or server down: keep what we have
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The current config, re-rendering when a new one arrives. */
export function useRemoteConfig(): RemoteConfig {
  return useSyncExternalStore(subscribeConfig, getConfig, getConfig);
}
