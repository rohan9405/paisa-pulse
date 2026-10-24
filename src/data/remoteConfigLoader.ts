"use client";

/**
 * Downloads the remote config (see backend/) and keeps the last good copy on
 * the device. Download-only: a plain GET with no cookies, no identifiers and
 * no data about you. Only configs signed with the owner's offline key (see
 * lib/configSignature.ts) and newer than the current one are applied; anything
 * else (offline, tampered, replayed, oversized) leaves the cached copy (or the
 * built-in defaults) in place.
 */
import { useSyncExternalStore } from "react";
import { MAX_CONFIG_BYTES, verifyEnvelope } from "@/lib/configSignature";
import { type RemoteConfig, getConfig, parseRemoteConfig, setConfig, subscribeConfig } from "@/lib/remoteConfig";

/** Set at build time (android/build.py reads it from android/local.json). Empty = remote config off. */
export const CONFIG_URL = process.env.NEXT_PUBLIC_CONFIG_URL ?? "";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
const CACHE_KEY = "drip:remote-config";

/** Apply the cached config, if any (it's re-verified: storage isn't trusted either). */
export async function loadCachedConfig() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const payload = raw ? await verifyEnvelope(JSON.parse(raw)) : null;
    if (payload) {
      const { config } = parseRemoteConfig(payload);
      if (config.version > getConfig().version) {
        setConfig(config);
        window.dispatchEvent(new Event("drip-config"));
      }
    }
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
      const res = await fetch(CONFIG_URL, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
      if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_CONFIG_BYTES * 2) return false;
      const text = await res.text();
      if (text.length > MAX_CONFIG_BYTES * 2) return false;
      const envelope: unknown = JSON.parse(text);
      const payload = await verifyEnvelope(envelope);
      if (!payload) return false; // unsigned or tampered: ignore
      const { config, errors } = parseRemoteConfig(payload);
      if (errors.length) console.warn("Remote config: some fields were ignored", errors);
      if (config.version <= getConfig().version) return false; // never go back to an older config (replays)
      setConfig(config);
      try {
        window.localStorage.setItem(CACHE_KEY, text);
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
