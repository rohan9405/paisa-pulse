/**
 * drip config backend (Cloudflare Worker).
 *
 *   GET  /config.json            public, read by the app; no cookies, nothing logged or stored about callers
 *   GET  /admin                  editor (HTTP Basic auth: user "admin", password = ADMIN_PASSWORD secret)
 *   GET  /admin/api/config       current config, defaults, history
 *   POST /admin/api/publish      { config, note } → validated with the app's own parser, saved as a new version
 *   POST /admin/api/rollback     { version } → republishes an old version as a new one
 *
 * The config only holds settings (tabs, text, rules, switches); never user data.
 */
import { CATEGORIES, TAGS } from "../../src/lib/categorize";
import { DEFAULT_CONFIG, type RemoteConfig, SCREEN_IDS, TAB_IDS, parseRemoteConfig } from "../../src/lib/remoteConfig";
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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

async function current(env: Env): Promise<RemoteConfig> {
  const raw = await env.CONFIG.get("current");
  return raw ? parseRemoteConfig(JSON.parse(raw)).config : DEFAULT_CONFIG;
}

async function history(env: Env): Promise<HistoryItem[]> {
  return JSON.parse((await env.CONFIG.get("history")) ?? "[]");
}

async function save(env: Env, config: RemoteConfig, note: string): Promise<RemoteConfig> {
  const latest = (await history(env))[0]?.version ?? 0;
  const published: RemoteConfig = { ...config, version: Math.max(latest, (await current(env)).version) + 1, publishedAt: new Date().toISOString() };
  const items = [{ version: published.version, publishedAt: published.publishedAt!, note: note.slice(0, 120) }, ...(await history(env))].slice(0, 50);
  await env.CONFIG.put(`v:${published.version}`, JSON.stringify(published));
  await env.CONFIG.put("current", JSON.stringify(published));
  await env.CONFIG.put("history", JSON.stringify(items));
  return published;
}

/** Constant-time compare so the password can't be guessed by timing. */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function authorised(req: Request, env: Env): boolean {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12) return false; // never run the admin without a real password
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Basic ")) return false;
  const [user, ...rest] = atob(h.slice(6)).split(":");
  return user === "admin" && safeEqual(rest.join(":"), env.ADMIN_PASSWORD);
}

const ADMIN_HEADERS = { "x-robots-tag": "noindex", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/config.json") {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET" } });
      if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
      return json(await current(env), 200, { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" });
    }

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      if (!authorised(req, env)) {
        return new Response(env.ADMIN_PASSWORD ? "Sign in required" : "Admin is off until the ADMIN_PASSWORD secret is set (12+ characters).", {
          status: 401,
          headers: { ...ADMIN_HEADERS, ...(env.ADMIN_PASSWORD ? { "www-authenticate": 'Basic realm="drip admin", charset="UTF-8"' } : {}) },
        });
      }
      if (url.pathname === "/admin" && req.method === "GET") {
        const meta = { categories: CATEGORIES, tags: TAGS, tabIds: TAB_IDS, screenIds: SCREEN_IDS };
        return new Response(adminPage(meta), { headers: { "content-type": "text/html; charset=utf-8", ...ADMIN_HEADERS } });
      }
      if (url.pathname === "/admin/api/config" && req.method === "GET") {
        return json({ current: await current(env), defaults: DEFAULT_CONFIG, history: await history(env) }, 200, ADMIN_HEADERS);
      }
      if (req.method === "POST" && (req.headers.get("content-type") ?? "").includes("application/json")) {
        const body = (await req.json().catch(() => null)) as { config?: unknown; note?: string; version?: number } | null;
        if (url.pathname === "/admin/api/publish") {
          const { config, errors } = parseRemoteConfig({ ...(body?.config as object), version: 0 });
          if (errors.length) return json({ ok: false, errors }, 400, ADMIN_HEADERS); // publish only what the app will accept in full
          return json({ ok: true, config: await save(env, config, body?.note ?? "") }, 200, ADMIN_HEADERS);
        }
        if (url.pathname === "/admin/api/rollback" && typeof body?.version === "number") {
          const raw = await env.CONFIG.get(`v:${body.version}`);
          if (!raw) return json({ ok: false, errors: [`Version ${body.version} not found`] }, 404, ADMIN_HEADERS);
          return json({ ok: true, config: await save(env, parseRemoteConfig(JSON.parse(raw)).config, `Rollback to v${body.version}`) }, 200, ADMIN_HEADERS);
        }
      }
      return new Response("Not found", { status: 404, headers: ADMIN_HEADERS });
    }

    return new Response("drip config service", { headers: { "content-type": "text/plain" } });
  },
};
