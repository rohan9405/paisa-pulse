/**
 * drip config backend (Cloudflare Worker).
 *
 *   GET  /config.json               public signed envelope { payload, sig, kid }; no cookies, callers aren't logged
 *   GET  /admin                     editor (HTTP Basic auth: user "admin", password = ADMIN_PASSWORD secret)
 *   GET  /admin/api/config          current config, defaults, history
 *   GET  /admin/api/version/:n      an older version, to load into the editor
 *   POST /admin/api/prepare         { config } → validated payload for the next version, to be signed
 *   POST /admin/api/publish         { payload, sig, note } → stored only if signed with the owner's key
 *
 * Security model (see SECURITY.md): the password lets you use the editor, but
 * apps only accept configs signed with a private key that never leaves the
 * owner's Mac (the editor signs in the browser). So a leaked password, a
 * compromised Cloudflare account or edited storage can't change any app.
 */
import { CATEGORIES, TAGS } from "../../src/lib/categorize";
import { CONFIG_PUBLIC_KEY } from "../../src/lib/configKey";
import { MAX_CONFIG_BYTES, verifyEnvelope } from "../../src/lib/configSignature";
import { ALLOWED_LINK_PREFIXES, DEFAULT_CONFIG, type RemoteConfig, SCREEN_IDS, TAB_IDS, parseRemoteConfig } from "../../src/lib/remoteConfig";
import { adminPage } from "./admin";

export interface Env {
  CONFIG: KVNamespace;
  ADMIN_PASSWORD?: string;
}

interface HistoryItem {
  version: number;
  publishedAt: string;
  note: string;
}

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_SECONDS = 900;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

async function currentEnvelope(env: Env): Promise<string | null> {
  return env.CONFIG.get("current");
}

async function currentConfig(env: Env): Promise<RemoteConfig> {
  const raw = await currentEnvelope(env);
  const payload = raw ? await verifyEnvelope(JSON.parse(raw)) : null;
  return payload ? parseRemoteConfig(payload).config : DEFAULT_CONFIG;
}

async function history(env: Env): Promise<HistoryItem[]> {
  return JSON.parse((await env.CONFIG.get("history")) ?? "[]");
}

async function nextVersion(env: Env): Promise<number> {
  return Math.max((await history(env))[0]?.version ?? 0, (await currentConfig(env)).version) + 1;
}

/** Constant-time compare so the password can't be guessed by timing. */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function authorise(req: Request, env: Env): Promise<"ok" | "denied" | "locked" | "off"> {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 20) return "off"; // never run the editor without a long password
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  const failKey = `fail:${ip}`;
  const fails = Number((await env.CONFIG.get(failKey)) ?? 0);
  if (fails >= MAX_FAILED_LOGINS) return "locked";
  const h = req.headers.get("authorization") ?? "";
  let ok = false;
  if (h.startsWith("Basic ")) {
    try {
      const [user, ...rest] = atob(h.slice(6)).split(":");
      ok = user === "admin" && safeEqual(rest.join(":"), env.ADMIN_PASSWORD);
    } catch {
      ok = false;
    }
  }
  if (!ok && h) await env.CONFIG.put(failKey, String(fails + 1), { expirationTtl: LOCKOUT_SECONDS }); // only the IP of failed admin logins, for 15 minutes
  return ok ? "ok" : "denied";
}

function adminHeaders(nonce?: string): Record<string, string> {
  return {
    "x-robots-tag": "noindex",
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce ?? "none"}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
  };
}

/** Admin writes must come from the editor page itself, not another site (CSRF). */
function sameOrigin(req: Request, url: URL): boolean {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  return origin === url.origin && (site === null || site === "same-origin");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/config.json") {
      if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const envelope = await currentEnvelope(env);
      if (!envelope) return new Response("No config published", { status: 404, headers: { "access-control-allow-origin": "*" } });
      return new Response(envelope, { headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
    }

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      const auth = await authorise(req, env);
      if (auth === "off") return new Response("The editor is off until the ADMIN_PASSWORD secret is set (20+ characters).", { status: 503, headers: adminHeaders() });
      if (auth === "locked") return new Response("Too many wrong passwords. Try again in 15 minutes.", { status: 429, headers: adminHeaders() });
      if (auth === "denied") return new Response("Sign in required", { status: 401, headers: { ...adminHeaders(), "www-authenticate": 'Basic realm="drip admin", charset="UTF-8"' } });

      if (url.pathname === "/admin" && req.method === "GET") {
        const nonce = crypto.randomUUID().replace(/-/g, "");
        const meta = { categories: CATEGORIES, tags: TAGS, tabIds: TAB_IDS, screenIds: SCREEN_IDS, kid: CONFIG_PUBLIC_KEY.kid, allowedLinks: ALLOWED_LINK_PREFIXES };
        return new Response(adminPage(meta, nonce), { headers: { "content-type": "text/html; charset=utf-8", ...adminHeaders(nonce) } });
      }
      if (url.pathname === "/admin/api/config" && req.method === "GET") {
        return json({ current: await currentConfig(env), defaults: DEFAULT_CONFIG, history: await history(env), nextVersion: await nextVersion(env) }, 200, adminHeaders());
      }
      const old = url.pathname.match(/^\/admin\/api\/version\/(\d{1,9})$/);
      if (old && req.method === "GET") {
        const raw = await env.CONFIG.get(`v:${old[1]}`);
        const payload = raw ? await verifyEnvelope(JSON.parse(raw)) : null;
        return payload ? json({ config: parseRemoteConfig(payload).config }, 200, adminHeaders()) : json({ errors: ["Not found"] }, 404, adminHeaders());
      }

      if (req.method === "POST") {
        if (!sameOrigin(req, url)) return json({ ok: false, errors: ["Requests must come from the editor page"] }, 403, adminHeaders());
        if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return json({ ok: false, errors: ["JSON only"] }, 415, adminHeaders());
        const text = await req.text();
        if (text.length > MAX_CONFIG_BYTES * 2) return json({ ok: false, errors: ["Too large"] }, 413, adminHeaders());
        const body = JSON.parse(text || "null") as { config?: unknown; payload?: string; sig?: string; note?: string } | null;

        if (url.pathname === "/admin/api/prepare") {
          const { config, errors } = parseRemoteConfig({ ...(body?.config as object), version: 0 });
          if (errors.length) return json({ ok: false, errors }, 400, adminHeaders());
          const payload = JSON.stringify({ ...config, version: await nextVersion(env), publishedAt: new Date().toISOString() });
          return json({ ok: true, payload }, 200, adminHeaders());
        }

        if (url.pathname === "/admin/api/publish") {
          const envelope = { payload: body?.payload, sig: body?.sig, kid: CONFIG_PUBLIC_KEY.kid };
          const payload = await verifyEnvelope(envelope);
          if (!payload) return json({ ok: false, errors: ["Signature doesn't match the app's key. Load the right key file."] }, 400, adminHeaders());
          const { config, errors } = parseRemoteConfig(payload);
          if (errors.length) return json({ ok: false, errors }, 400, adminHeaders());
          if (config.version !== (await nextVersion(env))) return json({ ok: false, errors: ["Someone published in the meantime. Reload and try again."] }, 409, adminHeaders());
          const stored = JSON.stringify(envelope);
          const items = [{ version: config.version, publishedAt: config.publishedAt ?? "", note: String(body?.note ?? "").slice(0, 120) }, ...(await history(env))].slice(0, 50);
          await env.CONFIG.put(`v:${config.version}`, stored);
          await env.CONFIG.put("current", stored);
          await env.CONFIG.put("history", JSON.stringify(items));
          return json({ ok: true, version: config.version }, 200, adminHeaders());
        }
      }
      return new Response("Not found", { status: 404, headers: adminHeaders() });
    }

    return new Response("drip config service", { headers: { "content-type": "text/plain" } });
  },
};
