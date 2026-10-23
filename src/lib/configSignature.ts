/**
 * Signed remote config. The backend serves an envelope { payload, sig, kid }:
 * `payload` is the config JSON as a string, `sig` an ECDSA P-256 / SHA-256
 * signature over its UTF-8 bytes, made with a private key that only exists on
 * the owner's Mac. The app verifies it against CONFIG_PUBLIC_KEY before using
 * anything, so neither the server, its storage, nor anyone with the admin
 * password can change what apps do without that key.
 */
import { CONFIG_PUBLIC_KEY } from "./configKey";

export interface SignedEnvelope {
  payload: string;
  sig: string;
  kid: string;
}

/** Bigger than any real config; anything larger is refused unread. */
export const MAX_CONFIG_BYTES = 256_000;

export function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of u) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let keyPromise: Promise<CryptoKey> | null = null;
function publicKey(jwk: JsonWebKey = CONFIG_PUBLIC_KEY): Promise<CryptoKey> {
  if (jwk !== CONFIG_PUBLIC_KEY) return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  keyPromise ??= crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return keyPromise;
}

/**
 * Returns the parsed payload if `input` is an envelope correctly signed with
 * the built-in key (or `key`, for tests), otherwise null. Never throws.
 */
export async function verifyEnvelope(input: unknown, key?: JsonWebKey & { kid?: string }): Promise<unknown | null> {
  try {
    if (typeof input !== "object" || input === null) return null;
    const { payload, sig, kid } = input as Partial<SignedEnvelope>;
    if (typeof payload !== "string" || typeof sig !== "string" || typeof kid !== "string") return null;
    if (payload.length > MAX_CONFIG_BYTES || sig.length > 200) return null;
    if (kid !== (key?.kid ?? CONFIG_PUBLIC_KEY.kid)) return null;
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await publicKey(key), base64urlToBytes(sig), new TextEncoder().encode(payload));
    return ok ? JSON.parse(payload) : null;
  } catch {
    return null;
  }
}
