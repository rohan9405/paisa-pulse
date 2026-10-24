import { afterEach, describe, expect, it } from "vitest";
import { incomeDate } from "@/lib/budget";
import { cleanMerchantName } from "@/lib/merchants";
import { DEFAULT_CONFIG, compareVersions, parseRemoteConfig, setConfig } from "@/lib/remoteConfig";
import { bankForSender, parseBankSms } from "@/lib/sms";
import { currentBuiltInRules } from "@/data/migrate";

afterEach(() => setConfig(DEFAULT_CONFIG));

describe("parsing", () => {
  it("falls back to defaults for anything that isn't a valid config", () => {
    expect(parseRemoteConfig(null).config).toEqual(DEFAULT_CONFIG);
    expect(parseRemoteConfig("hello").errors).toHaveLength(1);
  });

  it("keeps valid parts, drops invalid ones, and explains why", () => {
    const { config, errors } = parseRemoteConfig({
      version: 3,
      tabs: [{ id: "stats", label: "Insights" }, { id: "today", label: "Home", visible: false }, { id: "nope" }],
      rules: [{ contains: "pharmacy", category: "Health" }, { contains: "x", category: "Health" }, { contains: "abc", category: "Made up" }],
      banks: [{ sender: "YESBNK", bank: "Yes Bank" }, { sender: "<script>", bank: "x" }],
      budget: { lateSalaryDay: 99, nightBriefHour: 20 },
      announcement: { id: "a1", text: "Hi", link: "javascript:alert(1)" },
      update: { latestVersion: "latest", url: "https://x" },
    });
    expect(config.version).toBe(3);
    // Order from the config, unknown ids dropped, missing tabs appended, Today can't be hidden.
    expect(config.tabs.map((t) => [t.id, t.label, t.visible])).toEqual([["stats", "Insights", true], ["today", "Home", true], ["briefing", "Brief", false], ["manual", "Manual log", true], ["activity", "Activity", true], ["settings", "Settings", true]]);
    expect(config.rules).toEqual([{ contains: "pharmacy", category: "Health", tag: undefined, kind: undefined, direction: undefined, priority: 5 }]);
    expect(config.banks).toEqual([{ sender: "YESBNK", bank: "Yes Bank" }]);
    expect(config.budget).toMatchObject({ lateSalaryDay: 25, nightBriefHour: 20 });
    expect(config.announcement).toBeNull(); // a disallowed link drops the whole banner
    expect(config.update).toBeNull();
    expect(errors.length).toBe(5); // 2 rules, 1 bank, the javascript: link, the update; out-of-range numbers just use defaults
  });

  it("compares versions", () => {
    expect(compareVersions("0.6.0", "0.7.0")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

describe("applied config", () => {
  const apply = (input: object) => setConfig(parseRemoteConfig({ version: 1, ...input }).config);

  it("adds rules, switches built-ins off", () => {
    apply({ rules: [{ contains: "tea stall", category: "Food & Dining" }], disabledRules: ["ola"] });
    const rules = currentBuiltInRules();
    expect(rules.find((r) => r.pattern === "tea stall")).toMatchObject({ category: "Food & Dining", builtIn: true });
    expect(rules.find((r) => r.pattern === "ola")).toBeUndefined();
  });

  it("adds banks, merchant names and ignore phrases", () => {
    expect(bankForSender("VM-YESBNK-S")).toBeNull();
    apply({ banks: [{ sender: "YESBNK", bank: "Yes Bank" }], merchants: [{ contains: "chaipt", name: "Chai Point" }], smsIgnore: ["cashback credited"] });
    expect(bankForSender("VM-YESBNK-S")).toBe("Yes Bank");
    expect(cleanMerchantName("CHAIPT RETAIL")).toBe("Chai Point");
    expect(parseBankSms({ address: "VM-HDFCBK", body: "Rs 50 cashback credited to your HDFC Bank A/c XX1234" })).toBeNull();
  });

  it("moves the late-salary day", () => {
    expect(incomeDate({ date: "2026-08-22", amountPaise: 50_000_00 })).toBe("2026-08-22");
    apply({ budget: { lateSalaryDay: 20 } });
    expect(incomeDate({ date: "2026-08-22", amountPaise: 50_000_00 })).toBe("2026-09-01");
  });
});
