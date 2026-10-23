/**
 * The app's built-in categorisation rules and merchant names in remote-config
 * form, so the backend can own (and edit) them. General rules only: nothing
 * here is about any one person.
 */
import { DEFAULT_RULES } from "./categorize";
import { BRANDS, SHORT_BRANDS } from "./merchants";
import type { RemoteConfig, RemoteRule } from "./remoteConfig";

export function builtInsAsConfig(): Pick<RemoteConfig, "rules" | "merchants" | "replaceBuiltInRules" | "replaceBuiltInMerchants"> {
  const rules: RemoteRule[] = DEFAULT_RULES.map((r) => ({
    contains: r.pattern.trim().toLowerCase(),
    category: r.category,
    ...(r.tag ? { tag: r.tag } : {}),
    ...(r.kind ? { kind: r.kind } : {}),
    ...(r.direction ? { direction: r.direction } : {}),
    priority: r.priority,
  }));
  const merchants = [
    ...BRANDS.map(([contains, name]) => ({ contains, name })),
    // "/\bola\b/" → whole word "ola"
    ...SHORT_BRANDS.map(([re, name]) => ({ contains: re.source.replace(/\\b/g, ""), name, word: true })),
  ];
  return { rules, merchants, replaceBuiltInRules: true, replaceBuiltInMerchants: true };
}
