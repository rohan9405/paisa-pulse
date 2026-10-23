import { afterEach, describe, expect, it } from "vitest";
import { builtInsAsConfig } from "@/lib/builtInsAsConfig";
import { DEFAULT_RULES, categorize } from "@/lib/categorize";
import { cleanMerchantName } from "@/lib/merchants";
import { DEFAULT_CONFIG, parseRemoteConfig, setConfig } from "@/lib/remoteConfig";
import { currentBuiltInRules } from "@/data/migrate";

afterEach(() => setConfig(DEFAULT_CONFIG));

const SAMPLES: [string, "in" | "out"][] = [
  ["Swiggy order", "out"], ["DOMINO'S PIZZA", "out"], ["Ola ride", "out"], ["Coca Cola store", "out"], ["Jio recharge", "out"],
  ["BESCOM bill", "out"], ["Rent for October", "out"], ["NACH MF SIP", "out"], ["sip payment", "out"], ["Zerodha", "out"],
  ["INDIAN CLEARING CORP", "out"], ["Recurring deposit RD", "out"], ["Salary credit", "in"], ["ACH ITC LTD DIV", "in"],
  ["ACH D- BAJAJ FINANCE EMI", "out"], ["Wellness Pharmacy", "out"], ["Sun Pharma dividend ACH", "in"], ["Nothing known", "out"],
];
const MERCHANTS = ["MAKEMYTRIP INDI", "AMAZON PAY INDIA PRIVA", "BUNDL TECHNOLOGIES", "OLA CABS", "Coca Cola Store", "KFC Koramangala", "CHAI POINT PVT LTD", "Uber India"];

const asRules = () => currentBuiltInRules();

describe("built-in rules and names, owned by the config", () => {
  const exported = builtInsAsConfig();

  it("converts every built-in, and the result passes the app's own validation", () => {
    const { config, errors } = parseRemoteConfig({ version: 2, ...exported });
    expect(errors).toEqual([]);
    expect(config.rules).toHaveLength(DEFAULT_RULES.length);
    expect(config.replaceBuiltInRules).toBe(true);
    expect(config.replaceBuiltInMerchants).toBe(true);
    expect(config.merchants.length).toBe(exported.merchants.length);
  });

  it("categorises exactly the same either way", () => {
    const before = SAMPLES.map(([t, d]) => categorize(t, asRules(), undefined, { merchant: t, direction: d }));
    setConfig(parseRemoteConfig({ version: 2, ...exported }).config);
    const after = SAMPLES.map(([t, d]) => categorize(t, asRules(), undefined, { merchant: t, direction: d }));
    const strip = (r: ReturnType<typeof categorize>) => r && { category: r.category, kind: r.kind, tag: r.tag };
    expect(after.map(strip)).toEqual(before.map(strip));
    expect(asRules().every((r) => r.id.startsWith("remote-"))).toBe(true); // built-ins switched off, config list used
  });

  it("cleans merchant names the same either way", () => {
    const before = MERCHANTS.map(cleanMerchantName);
    setConfig(parseRemoteConfig({ version: 2, ...exported }).config);
    expect(MERCHANTS.map(cleanMerchantName)).toEqual(before);
    expect(cleanMerchantName("Coca Cola Store")).toBe("Coca Cola Store"); // whole-word "ola" doesn't fire
  });

  it("an empty list can never switch the built-ins off", () => {
    const { config } = parseRemoteConfig({ version: 2, rules: [], replaceBuiltInRules: true, merchants: [], replaceBuiltInMerchants: true });
    expect(config.replaceBuiltInRules).toBe(false);
    expect(config.replaceBuiltInMerchants).toBe(false);
  });
});
