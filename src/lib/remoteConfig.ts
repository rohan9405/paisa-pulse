/**
 * Remote config: global settings changed from the backend (backend/) without an
 * app release. It's data only (text, order, rules, switches): it can't run code
 * and the app never sends anything back. Every field is validated; anything
 * invalid is dropped and the built-in default is used instead.
 *
 * The app reads the current config through getConfig(); pure library code
 * (rules, merchant names, bank senders, thresholds) uses it too, so tests see
 * the defaults unless they call setConfig().
 */
import { CATEGORIES } from "./categorize";
import type { SetAsideMode, TxnKind } from "./types";

export const TAB_IDS = ["today", "briefing", "manual", "activity", "stats", "settings"] as const;
export type TabId = (typeof TAB_IDS)[number];
export const SCREEN_IDS = ["today", "briefing", "activity", "stats", "settings", "import"] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

export interface RemoteRule {
  /** Case-insensitive text the merchant / SMS must contain. */
  contains: string;
  category: string;
  tag?: string;
  kind?: TxnKind;
  /** Only money in, or only money out. */
  direction?: "in" | "out";
  /** Higher wins; built-ins are 0, your own rules 10. */
  priority: number;
  /** Off by default. Applies this rule to untouched payments in the last 12 months. */
  applyToHistory?: boolean;
  /** Increment to explicitly repeat a history job without changing the rule. */
  historyRevision?: number;
}

export interface RemoteConfig {
  /** Bumped on every publish. 0 = built-in defaults. */
  version: number;
  publishedAt?: string;
  /** Bottom tabs, in order. Today can't be hidden. */
  tabs: { id: TabId; label: string; visible: boolean }[];
  primaryAction: TabId;
  /** Page title / subtitle per screen; empty = the screen's own text. */
  screens: Partial<Record<ScreenId, { title?: string; subtitle?: string }>>;
  /** Extra categorisation rules, applied like built-ins. */
  rules: RemoteRule[];
  /** Built-in rule patterns to switch off (e.g. "ola"). */
  disabledRules: string[];
  /** True: `rules` is the complete list and the app's built-in rules are not used. */
  replaceBuiltInRules: boolean;
  /**
   * Merchant name clean-ups: text contains → display name. `word`: match as a
   * whole word ("ola" must not match "coca cola"); otherwise letters/digits only, anywhere.
   */
  merchants: { contains: string; name: string; word?: boolean }[];
  /** True: `merchants` is the complete list and the app's built-in names are not used. */
  replaceBuiltInMerchants: boolean;
  /** SMS parsing: plain text the merchant name comes right after, for money out, in, or both. Tried before the app's generic "at / to / from". */
  merchantAfter: { text: string; direction?: "in" | "out" }[];
  /** SMS parsing: extra words or characters that end a merchant name (the app already stops at "on", "bal", "." …). */
  merchantStops: string[];
  /**
   * Re-read stored SMS text (never the inbox) with the current parsing, names and
   * rules. Off when null. Runs once per `run` number; transactions the user edited
   * are never changed.
   */
  smsReread: {
    run: number;
    /** How far back from today, 1–12 months. */
    months: number;
    names: boolean;
    categories: boolean;
    /** "unnamed": only payments where no merchant was found ("ICICI debit"). */
    only: "all" | "unnamed";
    /** Only SMS whose text contains this. */
    contains?: string;
  } | null;
  /** More bank SMS senders: sender ID core (e.g. "YESBNK") → bank name. */
  banks: { sender: string; bank: string }[];
  /** True: `banks` is the complete list and the app's built-in senders are not used. */
  replaceBuiltInBanks: boolean;
  /** Extra phrases that mean "not a transaction" (offers, OTPs…). */
  smsIgnore: string[];
  budget: {
    /** Choices offered for new/edited budgets; existing plans remain unchanged. */
    setAsideModes: SetAsideMode[];
    /** From this day of the month, a salary counts for the next month (actual mode). */
    lateSalaryDay: number;
    /** Credits at least this big count as salary for that rule. */
    bigCreditRupees: number;
    /** Briefing switches from the morning to the night brief at this hour (IST). */
    nightBriefHour: number;
    /** Weekly insight: minimum change in rupees, and minimum rise in %. */
    insightMinRupees: number;
    insightRisePct: number;
  };
  features: {
    balances: boolean;
    appLock: boolean;
    csvImport: boolean;
    insights: boolean;
    badges: boolean;
    haptics: boolean;
    /** Anonymous usage counts (data/usage.ts). People can also switch it off in Settings. */
    analytics: boolean;
  };
  /** A banner on Today. Changing the id shows it again to people who dismissed the old one. */
  announcement: { id: string; text: string; link?: string; tone: "info" | "warn" } | null;
  /** "A new version is available" notice, shown when the app is older than latestVersion. */
  update: { latestVersion: string; url: string; message?: string } | null;
}

export const DEFAULT_CONFIG: RemoteConfig = {
  version: 0,
  primaryAction: "today",
  tabs: [
    { id: "today", label: "Today", visible: true },
    { id: "briefing", label: "Brief", visible: false },
    { id: "manual", label: "Manual log", visible: true },
    { id: "activity", label: "Activity", visible: true },
    { id: "stats", label: "Stats", visible: true },
    { id: "settings", label: "Settings", visible: true },
  ],
  screens: {},
  rules: [],
  disabledRules: [],
  replaceBuiltInRules: false,
  merchants: [],
  replaceBuiltInMerchants: false,
  merchantAfter: [],
  merchantStops: [],
  smsReread: null,
  banks: [],
  replaceBuiltInBanks: false,
  smsIgnore: [],
  budget: { setAsideModes: ["planned", "actual"], lateSalaryDay: 25, bigCreditRupees: 10_000, nightBriefHour: 17, insightMinRupees: 300, insightRisePct: 25 },
  features: { balances: true, appLock: true, csvImport: true, insights: true, badges: true, haptics: true, analytics: true },
  announcement: null,
  update: null,
};

// ------------------------------------------------------------------ validation

const KINDS: TxnKind[] = ["expense", "commitment", "investment", "transfer", "refund", "settlement", "income"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number, min = 1) => (typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : undefined);
const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
/**
 * Links in a config (banner, update notice) may only point here. Built into the
 * app, so even a correctly signed config can't send people to a phishing page
 * or a fake APK.
 */
export const ALLOWED_LINK_PREFIXES = ["https://github.com/rohan9405/paisa-pulse/", "https://github.com/rohan9405/paisa-pulse#"];
const allowedUrl = (v: unknown) => {
  const s = str(v, 300);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    const normal = u.href;
    return u.protocol === "https:" && !u.username && !u.password && ALLOWED_LINK_PREFIXES.some((p) => normal.startsWith(p) || normal === p.slice(0, -1)) ? normal : undefined;
  } catch {
    return undefined;
  }
};

export interface ParseResult {
  config: RemoteConfig;
  /** Human-readable problems; each one means that part fell back to the default. */
  errors: string[];
}

/** Turn untrusted JSON into a safe config. Never throws. */
export function parseRemoteConfig(input: unknown): ParseResult {
  const errors: string[] = [];
  const c: RemoteConfig = structuredClone(DEFAULT_CONFIG);
  if (!isObj(input)) return { config: c, errors: ["Config isn't a JSON object"] };

  c.version = int(input.version, 0, 1e9) ?? (errors.push("version must be a whole number"), 0);
  if (typeof input.publishedAt === "string") c.publishedAt = input.publishedAt.slice(0, 40);

  if (input.tabs !== undefined) {
    const tabs = Array.isArray(input.tabs) ? input.tabs.filter(isObj) : [];
    const seen = new Set<string>();
    const out: RemoteConfig["tabs"] = [];
    for (const t of tabs) {
      const id = TAB_IDS.find((x) => x === t.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label: str(t.label, 16) ?? DEFAULT_CONFIG.tabs.find((d) => d.id === id)!.label, visible: id === "today" ? true : (bool(t.visible) ?? true) });
    }
    for (const d of DEFAULT_CONFIG.tabs) if (!seen.has(d.id)) out.push({ ...d }); // missing tabs keep their default place at the end
    if (out.length) c.tabs = out;
    else errors.push("tabs: none valid");
  }

  if (TAB_IDS.some((id) => id === input.primaryAction) && c.tabs.some((t) => t.id === input.primaryAction && t.visible)) c.primaryAction = input.primaryAction as TabId;

  if (isObj(input.screens)) {
    for (const id of SCREEN_IDS) {
      const s = input.screens[id];
      if (!isObj(s)) continue;
      const title = str(s.title, 40);
      const subtitle = str(s.subtitle, 120);
      if (title || subtitle) c.screens[id] = { title, subtitle };
    }
  }

  const categories = new Set<string>(CATEGORIES);
  if (Array.isArray(input.rules)) {
    for (const [i, r] of input.rules.slice(0, 500).entries()) {
      if (!isObj(r)) continue;
      const contains = str(r.contains, 60, 2);
      const category = typeof r.category === "string" && categories.has(r.category) ? r.category : undefined;
      if (!contains || !category) {
        errors.push(`rules[${i}]: needs "contains" (2–60 chars) and a known category`);
        continue;
      }
      const kind = KINDS.find((k) => k === r.kind);
      const direction = r.direction === "in" || r.direction === "out" ? r.direction : undefined;
      c.rules.push({ contains: contains.toLowerCase(), category, tag: str(r.tag, 30), kind, direction, priority: int(r.priority, 0, 100) ?? 5, ...(r.applyToHistory === true ? { applyToHistory: true, historyRevision: int(r.historyRevision, 0, 1e9) ?? 0 } : {}) });
    }
  }

  c.replaceBuiltInRules = input.replaceBuiltInRules === true && c.rules.length > 0; // never replace with nothing
  if (Array.isArray(input.disabledRules)) c.disabledRules = input.disabledRules.map((p) => str(p, 60)).filter((p): p is string => !!p).map((p) => p.toLowerCase()).slice(0, 500);

  if (Array.isArray(input.merchants)) {
    for (const m of input.merchants.slice(0, 500)) {
      if (!isObj(m)) continue;
      const word = m.word === true;
      const contains = str(m.contains, 60, word ? 2 : 3);
      const name = str(m.name, 40);
      if (!contains || !name) continue;
      const key = word ? contains.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : contains.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (key) c.merchants.push(word ? { contains: key, name, word } : { contains: key, name });
    }
  }

  c.replaceBuiltInMerchants = input.replaceBuiltInMerchants === true && c.merchants.length > 0;

  // Config v5 called these "merchantMarkers" (money out only).
  const after = Array.isArray(input.merchantAfter) ? input.merchantAfter : Array.isArray(input.merchantMarkers) ? input.merchantMarkers.map((text) => ({ text, direction: "out" })) : [];
  for (const a of after.slice(0, 100)) {
    if (!isObj(a)) continue;
    const text = typeof a.text === "string" && a.text.trim().length >= 2 && a.text.length <= 30 ? a.text.replace(/^\s+/, "") : undefined;
    const direction = a.direction === "in" || a.direction === "out" ? a.direction : undefined;
    if (!text) errors.push(`merchantAfter: "${String(a.text)}" needs 2–30 characters`);
    else if (!c.merchantAfter.some((x) => x.text.toLowerCase() === text.toLowerCase() && x.direction === direction)) c.merchantAfter.push(direction ? { text, direction } : { text });
  }
  if (isObj(input.smsReread)) {
    const r = input.smsReread;
    const run = int(r.run, 1, 1e9);
    const names = r.names === true;
    const categories = r.categories === true;
    if (run && (names || categories)) c.smsReread = { run, months: int(r.months, 1, 12) ?? 1, names, categories, only: r.only === "unnamed" ? "unnamed" : "all", ...(str(r.contains, 60) ? { contains: str(r.contains, 60) } : {}) };
    else errors.push("smsReread: needs a run number of 1 or more and names and/or categories");
  }
  if (Array.isArray(input.merchantStops)) c.merchantStops = [...new Set(input.merchantStops.map((p) => str(p, 20)).filter((p): p is string => !!p).map((p) => p.toLowerCase()))].slice(0, 100);

  if (Array.isArray(input.banks)) {
    for (const b of input.banks.slice(0, 100)) {
      if (!isObj(b)) continue;
      const sender = str(b.sender, 12, 3)?.toUpperCase();
      const bank = str(b.bank, 20);
      // Must contain letters: a phone number can never become a "bank". Ends in * (any letters) or ? (one optional letter).
      if (sender && /^[A-Z0-9]+[*?]?$/.test(sender) && /[A-Z]{3}/.test(sender) && bank) c.banks.push({ sender, bank });
      else errors.push(`banks: "${String(b.sender)}" isn't a sender ID like YESBNK or SBI*`);
    }
  }

  c.replaceBuiltInBanks = input.replaceBuiltInBanks === true && c.banks.length > 0;

  if (Array.isArray(input.smsIgnore)) c.smsIgnore = input.smsIgnore.map((p) => str(p, 60, 3)).filter((p): p is string => !!p).map((p) => p.toLowerCase()).slice(0, 200);

  if (isObj(input.budget)) {
    const b = input.budget;
    const modes = Array.isArray(b.setAsideModes) ? (["planned", "actual"] as const).filter(m => (b.setAsideModes as unknown[]).includes(m)) : [];
    c.budget = {
      setAsideModes: modes.length ? modes : [...DEFAULT_CONFIG.budget.setAsideModes],
      lateSalaryDay: int(b.lateSalaryDay, 15, 31) ?? DEFAULT_CONFIG.budget.lateSalaryDay,
      bigCreditRupees: int(b.bigCreditRupees, 1_000, 10_00_000) ?? DEFAULT_CONFIG.budget.bigCreditRupees,
      nightBriefHour: int(b.nightBriefHour, 12, 23) ?? DEFAULT_CONFIG.budget.nightBriefHour,
      insightMinRupees: int(b.insightMinRupees, 0, 1_00_000) ?? DEFAULT_CONFIG.budget.insightMinRupees,
      insightRisePct: int(b.insightRisePct, 5, 500) ?? DEFAULT_CONFIG.budget.insightRisePct,
    };
  }

  if (isObj(input.features)) {
    for (const k of Object.keys(DEFAULT_CONFIG.features) as (keyof RemoteConfig["features"])[]) {
      const v = bool(input.features[k]);
      if (v !== undefined) c.features[k] = v;
    }
  }

  if (isObj(input.announcement)) {
    const a = input.announcement;
    const id = str(a.id, 40);
    const text = str(a.text, 200);
    const link = a.link === undefined || a.link === "" ? undefined : allowedUrl(a.link);
    if (a.link && !link) errors.push(`announcement: links must start ${ALLOWED_LINK_PREFIXES[0]}`);
    else if (id && text) c.announcement = { id, text, link, tone: a.tone === "warn" ? "warn" : "info" };
    else errors.push("announcement: needs an id and text");
  }

  if (isObj(input.update)) {
    const u = input.update;
    const latestVersion = typeof u.latestVersion === "string" && /^\d+\.\d+\.\d+$/.test(u.latestVersion) ? u.latestVersion : undefined;
    const url = allowedUrl(u.url);
    if (latestVersion && url) c.update = { latestVersion, url, message: str(u.message, 160) };
    else errors.push(`update: needs latestVersion like 0.7.0 and a link starting ${ALLOWED_LINK_PREFIXES[0]}`);
  }

  return { config: c, errors };
}

/** -1 if a < b, 0 if equal, 1 if a > b ("0.6.0" style). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  return 0;
}

// ------------------------------------------------------------------ current config

let current: RemoteConfig = DEFAULT_CONFIG;
const listeners = new Set<() => void>();

export function getConfig(): RemoteConfig {
  return current;
}

export function setConfig(c: RemoteConfig) {
  current = c;
  for (const l of listeners) l();
}

export function subscribeConfig(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
