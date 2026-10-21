/**
 * Android-only device features (android/.../DeviceBridge.java exposes
 * `window.PaisaDevice`): light haptics and the fingerprint app lock.
 * Everything here is a no-op in a normal browser.
 */
export interface DeviceBridge {
  haptic(kind: "tap" | "success" | "error"): void;
  canLock(): boolean;
  appLockEnabled(): boolean;
  /** Turning on asks for the fingerprint first; fires `paisa-applock` when done (check appLockEnabled()). */
  setAppLock(on: boolean): void;
}

declare global {
  interface Window {
    PaisaDevice?: DeviceBridge;
  }
}

export function deviceBridge(): DeviceBridge | null {
  return typeof window !== "undefined" && window.PaisaDevice ? window.PaisaDevice : null;
}

let hapticsOn = true;

/** Set from the user's preference (AppShell keeps it in sync). */
export function setHapticsEnabled(on: boolean) {
  hapticsOn = on;
}

export function haptic(kind: "tap" | "success" | "error" = "tap") {
  if (hapticsOn) deviceBridge()?.haptic(kind);
}
