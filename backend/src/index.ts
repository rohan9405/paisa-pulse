/**
 * drip config backend (Cloudflare Worker).
 *
 *   GET    /config.json             public signed envelope { payload, sig, kid }; no cookies, callers aren't logged
 *   GET    /admin                   editor (HTTP Basic auth: user "admin", password = ADMIN_PASSWORD secret)
 *   GET    /admin/api/state         published config, draft, history
 *   PUT    /admin/api/draft         { config } → validated and saved as the draft (not live)
 *   DELETE /admin/api/draft         reset: discard all unpublished changes
 *   POST   /admin/api/publish       { note } → draft becomes the next version, signed here
 *   POST   /admin/api/revert        { version, note } → that version republished as the next version
 *   GET    /admin/api/version/:n    one version's config
 *
 * Apps only accept configs signed with the key whose public half is built into
 * them. The Worker signs on publish with that key (SIGNING_KEY secret), so the
 * admin password is what guards publishing; see SECURITY.md for what a config
 * can and can't do even then.
 */
import { CATEGORIES, TAGS } from "../../src/lib/categorize";
import { SECTION_FIELDS, SECTION_LABEL, SECTIONS, describeChanges } from "../../src/lib/configDiff";
import { CONFIG_PUBLIC_KEY } from "../../src/lib/configKey";
import { MAX_CONFIG_BYTES, bytesToBase64url, verifyEnvelope } from "../../src/lib/configSignature";
import { ALLOWED_LINK_PREFIXES, DEFAULT_CONFIG, type RemoteConfig, SCREEN_IDS, TAB_IDS, parseRemoteConfig } from "../../src/lib/remoteConfig";
import { adminPage } from "./admin";

export interface Env {
  CONFIG: KVNamespace;
  ADMIN_PASSWORD?: string;
  SIGNING_KEY?: string;
}

interface HistoryItem {
  version: number;
  publishedAt: string;
  note: string;
  changes: string[];
  /** Set when this version republished an older one. */
  revertOf?: number;
}

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_SECONDS = 900;
const MAX_HISTORY = 2000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

async function published(env: Env): Promise<RemoteConfig> {
  const raw = await env.CONFIG.get("current");
  const payload = raw ? await verifyEnvelope(JSON.parse(raw)) : null;
  return payload ? parseRemoteConfig(payload).config : DEFAULT_CONFIG;
}

async function draft(env: Env): Promise<RemoteConfig | null> {
  const raw = await env.CONFIG.get("draft");
  return raw ? parseRemoteConfig(JSON.parse(raw)).config : null;
}

async function history(env: Env): Promise<HistoryItem[]> {
  return JSON.parse((await env.CONFIG.get("history")) ?? "[]");
}

async function signer(env: Env): Promise<CryptoKey | null> {
  if (!env.SIGNING_KEY) return null;
  const jwk = JSON.parse(env.SIGNING_KEY) as JsonWebKey & { kid?: string };
  if (jwk.kid !== CONFIG_PUBLIC_KEY.kid || jwk.x !== CONFIG_PUBLIC_KEY.x || jwk.y !== CONFIG_PUBLIC_KEY.y) return null; // must match the key built into apps
  return crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** Sign `config` as the next version and make it live. */
async function release(env: Env, config: RemoteConfig, note: string, revertOf?: number): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const key = await signer(env);
  if (!key) return { ok: false, error: "Publishing is off: the SIGNING_KEY secret is missing or isn't the key the app trusts." };
  const before = await published(env);
  const items = await history(env);
  const version = Math.max(items[0]?.version ?? 0, before.version) + 1;
  const payload = JSON.stringify({ ...config, version, publishedAt: new Date().toISOString() });
  const sig = bytesToBase64url(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload)));
  const envelope = { payload, sig, kid: CONFIG_PUBLIC_KEY.kid };
  if (!(await verifyEnvelope(envelope))) return { ok: false, error: "Signing check failed; nothing was published." }; // apps would reject it
  const stored = JSON.stringify(envelope);
  const changes = describeChanges(before, config);
  const item: HistoryItem = { version, publishedAt: JSON.parse(payload).publishedAt, note: note.slice(0, 200), changes, ...(revertOf ? { revertOf } : {}) };
  await env.CONFIG.put(`v:${version}`, stored);
  await env.CONFIG.put("current", stored);
  await env.CONFIG.put("history", JSON.stringify([item, ...items].slice(0, MAX_HISTORY)));
  await env.CONFIG.delete("draft");
  return { ok: true, version };
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
      const envelope = await env.CONFIG.get("current");
      if (!envelope) return new Response("No config published", { status: 404, headers: { "access-control-allow-origin": "*" } });
      return new Response(envelope, { headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
    }

    if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return new Response("drip config service", { headers: { "content-type": "text/plain" } });

    const auth = await authorise(req, env);
    if (auth === "off") return new Response("The editor is off until the ADMIN_PASSWORD secret is set (20+ characters).", { status: 503, headers: adminHeaders() });
    if (auth === "locked") return new Response("Too many wrong passwords. Try again in 15 minutes.", { status: 429, headers: adminHeaders() });
    if (auth === "denied") return new Response("Sign in required", { status: 401, headers: { ...adminHeaders(), "www-authenticate": 'Basic realm="drip admin", charset="UTF-8"' } });
    const H = adminHeaders();

    if (url.pathname === "/admin" && req.method === "GET") {
      const nonce = crypto.randomUUID().replace(/-/g, "");
      const meta = { categories: CATEGORIES, tags: TAGS, tabIds: TAB_IDS, screenIds: SCREEN_IDS, allowedLinks: ALLOWED_LINK_PREFIXES, defaults: DEFAULT_CONFIG, sections: SECTIONS, sectionFields: SECTION_FIELDS, sectionLabels: SECTION_LABEL };
      return new Response(adminPage(meta, nonce), { headers: { "content-type": "text/html; charset=utf-8", ...adminHeaders(nonce) } });
    }
    if (url.pathname === "/admin/api/state" && req.method === "GET") {
      return json({ published: await published(env), draft: await draft(env), history: await history(env), canPublish: !!(await signer(env)) }, 200, H);
    }
    const one = url.pathname.match(/^\/admin\/api\/version\/(\d{1,9})$/);
    if (one && req.method === "GET") {
      const raw = await env.CONFIG.get(`v:${one[1]}`);
      const payload = raw ? await verifyEnvelope(JSON.parse(raw)) : null;
      return payload ? json({ config: parseRemoteConfig(payload).config }, 200, H) : json({ errors: ["Not found"] }, 404, H);
    }

    // Everything below changes state: only from the editor page, JSON only, size-limited.
    if (!["PUT", "POST", "DELETE"].includes(req.method)) return new Response("Not found", { status: 404, headers: H });
    if (!sameOrigin(req, url)) return json({ ok: false, errors: ["Requests must come from the editor page"] }, 403, H);
    if (url.pathname === "/admin/api/draft" && req.method === "DELETE") {
      await env.CONFIG.delete("draft");
      return json({ ok: true }, 200, H);
    }
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return json({ ok: false, errors: ["JSON only"] }, 415, H);
    const text = await req.text();
    if (text.length > MAX_CONFIG_BYTES * 2) return json({ ok: false, errors: ["Too large"] }, 413, H);
    let body: { config?: unknown; note?: unknown; version?: unknown } | null = null;
    try {
      body = JSON.parse(text || "null");
    } catch {
      return json({ ok: false, errors: ["Invalid JSON"] }, 400, H);
    }

    if (url.pathname === "/admin/api/draft" && req.method === "PUT") {
      const { config, errors } = parseRemoteConfig({ ...(body?.config as object), version: 0 });
      if (errors.length) return json({ ok: false, errors }, 400, H); // save only what apps will accept in full
      await env.CONFIG.put("draft", JSON.stringify(config));
      return json({ ok: true, draft: config }, 200, H);
    }
    if (url.pathname === "/admin/api/publish" && req.method === "POST") {
      const d = await draft(env);
      if (!d) return json({ ok: false, errors: ["Nothing to publish: no saved changes."] }, 400, H);
      const r = await release(env, d, String(body?.note ?? ""));
      return r.ok ? json(r, 200, H) : json({ ok: false, errors: [r.error] }, 503, H);
    }
    if (url.pathname === "/admin/api/revert" && req.method === "POST" && typeof body?.version === "number") {
      const raw = await env.CONFIG.get(`v:${body.version}`);
      const payload = raw ? await verifyEnvelope(JSON.parse(raw)) : null;
      if (!payload) return json({ ok: false, errors: [`Version ${body.version} not found`] }, 404, H);
      const r = await release(env, parseRemoteConfig(payload).config, String(body?.note ?? `Reverted to v${body.version}`), body.version);
      return r.ok ? json(r, 200, H) : json({ ok: false, errors: [r.error] }, 503, H);
    }
    return new Response("Not found", { status: 404, headers: H });
  },
};
