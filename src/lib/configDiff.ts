/**
 * Human-readable summary of what changed between two configs, per section,
 * for the backend's version history ("Rules: 2 added, 1 removed").
 */
import type { RemoteConfig } from "./remoteConfig";

export const SECTIONS = ["tabs", "screens", "rules", "merchants", "banks", "smsIgnore", "budget", "features", "announcement", "update"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABEL: Record<Section, string> = {
  tabs: "Tabs",
  screens: "Screen text",
  rules: "Rules",
  merchants: "Merchant names",
  banks: "Bank senders",
  smsIgnore: "Ignore phrases",
  budget: "Budget and insights",
  features: "Features",
  announcement: "Announcement",
  update: "New version notice",
};

/** The config fields each section edits. */
export const SECTION_FIELDS: Record<Section, (keyof RemoteConfig)[]> = {
  tabs: ["tabs"],
  screens: ["screens"],
  rules: ["rules", "disabledRules", "replaceBuiltInRules"],
  merchants: ["merchants", "replaceBuiltInMerchants"],
  banks: ["banks"],
  smsIgnore: ["smsIgnore"],
  budget: ["budget"],
  features: ["features"],
  announcement: ["announcement"],
  update: ["update"],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Sections whose fields differ. */
export function changedSections(a: RemoteConfig, b: RemoteConfig): Section[] {
  return SECTIONS.filter((s) => SECTION_FIELDS[s].some((f) => !same(a[f], b[f])));
}

function listDiff<T>(before: T[], after: T[], key: (x: T) => string, noun: string): string {
  const b = new Map(before.map((x) => [key(x), JSON.stringify(x)]));
  const a = new Map(after.map((x) => [key(x), JSON.stringify(x)]));
  const added = [...a.keys()].filter((k) => !b.has(k)).length;
  const removed = [...b.keys()].filter((k) => !a.has(k)).length;
  const edited = [...a.keys()].filter((k) => b.has(k) && b.get(k) !== a.get(k)).length;
  const parts = [added && `${added} added`, removed && `${removed} removed`, edited && `${edited} edited`].filter(Boolean);
  return parts.length ? parts.join(", ") : `${noun} reordered`;
}

/** One line per changed section. Empty if nothing changed. */
export function describeChanges(a: RemoteConfig, b: RemoteConfig): string[] {
  const out: string[] = [];
  for (const s of changedSections(a, b)) {
    const label = SECTION_LABEL[s];
    switch (s) {
      case "tabs": {
        const bits: string[] = [];
        if (!same(a.tabs.map((t) => t.id), b.tabs.map((t) => t.id))) bits.push("order changed");
        for (const t of b.tabs) {
          const old = a.tabs.find((x) => x.id === t.id);
          if (old && old.label !== t.label) bits.push(`${t.id} renamed “${t.label}”`);
          if (old && old.visible !== t.visible) bits.push(`${t.id} ${t.visible ? "shown" : "hidden"}`);
        }
        out.push(`${label}: ${bits.join(", ")}`);
        break;
      }
      case "screens": {
        const ids = new Set([...Object.keys(a.screens), ...Object.keys(b.screens)]) as Set<keyof RemoteConfig["screens"]>;
        const changed = [...ids].filter((id) => !same(a.screens[id], b.screens[id]));
        out.push(`${label}: ${changed.join(", ")}`);
        break;
      }
      case "rules": {
        const bits: string[] = [];
        if (!same(a.rules, b.rules)) bits.push(listDiff(a.rules, b.rules, (r) => `${r.contains}|${r.direction ?? ""}`, "rules"));
        if (!same(a.disabledRules, b.disabledRules)) bits.push(`${b.disabledRules.length} built-ins switched off`);
        if (a.replaceBuiltInRules !== b.replaceBuiltInRules) bits.push(b.replaceBuiltInRules ? "now replaces built-ins" : "built-ins back on");
        out.push(`${label}: ${bits.join("; ")}`);
        break;
      }
      case "merchants": {
        const bits: string[] = [];
        if (!same(a.merchants, b.merchants)) bits.push(listDiff(a.merchants, b.merchants, (m) => m.contains, "names"));
        if (a.replaceBuiltInMerchants !== b.replaceBuiltInMerchants) bits.push(b.replaceBuiltInMerchants ? "now replaces built-ins" : "built-ins back on");
        out.push(`${label}: ${bits.join("; ")}`);
        break;
      }
      case "banks":
        out.push(`${label}: ${listDiff(a.banks, b.banks, (x) => x.sender, "senders")}`);
        break;
      case "smsIgnore":
        out.push(`${label}: ${listDiff(a.smsIgnore, b.smsIgnore, (x) => x, "phrases")}`);
        break;
      case "budget":
        out.push(`${label}: ${(Object.keys(b.budget) as (keyof RemoteConfig["budget"])[]).filter((k) => a.budget[k] !== b.budget[k]).map((k) => `${k} ${a.budget[k]} → ${b.budget[k]}`).join(", ")}`);
        break;
      case "features":
        out.push(`${label}: ${(Object.keys(b.features) as (keyof RemoteConfig["features"])[]).filter((k) => a.features[k] !== b.features[k]).map((k) => `${k} ${b.features[k] ? "on" : "off"}`).join(", ")}`);
        break;
      case "announcement":
        out.push(`${label}: ${!b.announcement ? "removed" : !a.announcement ? `added “${b.announcement.text.slice(0, 40)}”` : `changed to “${b.announcement.text.slice(0, 40)}”`}`);
        break;
      case "update":
        out.push(`${label}: ${!b.update ? "removed" : `latest ${b.update.latestVersion}`}`);
        break;
    }
  }
  return out;
}
