import { describe, expect, it } from "vitest";
import { changedSections, describeChanges } from "@/lib/configDiff";
import { DEFAULT_CONFIG, type RemoteConfig } from "@/lib/remoteConfig";

const base = (): RemoteConfig => structuredClone(DEFAULT_CONFIG);

describe("version history summaries", () => {
  it("says nothing when nothing changed", () => {
    expect(describeChanges(base(), base())).toEqual([]);
  });

  it("describes each changed section in one line", () => {
    const a = base();
    const b = base();
    a.tabs[1].visible = true;
    b.tabs = [b.tabs[0], b.tabs[3], b.tabs[2], { ...b.tabs[1], label: "Brief", visible: false }];
    b.rules = [{ contains: "tea stall", category: "Food & Dining", priority: 5 }];
    b.replaceBuiltInRules = true;
    b.features.badges = false;
    b.budget.lateSalaryDay = 27;
    b.announcement = { id: "a1", text: "New: balances on Today", tone: "info" };
    expect(changedSections(a, b)).toEqual(["tabs", "rules", "budget", "features", "announcement"]);
    expect(describeChanges(a, b)).toEqual([
      "Tabs: order changed, briefing hidden",
      "Rules: 1 added; now replaces built-ins",
      "Budget and insights: lateSalaryDay 25 → 27",
      "Features: badges off",
      "Announcement: added “New: balances on Today”",
    ]);
  });

  it("counts added, removed and edited list items", () => {
    const a = base();
    a.merchants = [{ contains: "abc", name: "Abc" }, { contains: "def", name: "Def" }];
    const b = base();
    b.merchants = [{ contains: "abc", name: "ABC Co" }, { contains: "ghi", name: "Ghi" }];
    expect(describeChanges(a, b)).toEqual(["Merchant names: 1 added, 1 removed, 1 edited"]);
  });
});
