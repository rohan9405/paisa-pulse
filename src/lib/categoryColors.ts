import { CATEGORIES } from "./categorize";

// Permanent category identities, separate from lime/coral/amber status colours
// and the violet comparison charts. Never assign by sort order or label hash.
export const CATEGORY_COLORS: Readonly<Record<(typeof CATEGORIES)[number], string>> = {
  "Food & Dining": "#D6A083",
  Groceries: "#6FAEAD",
  Transport: "#72A9D4",
  Shopping: "#C895AC",
  Entertainment: "#8799BE",
  Subscriptions: "#B4A68C",
  Bills: "#4E8EA6",
  Health: "#8DBDBD",
  Travel: "#D6B89A",
  Education: "#9AAFC6",
  "Personal Care": "#CCAEBF",
  "Gifts & Donations": "#B59D8B",
  Investments: "#7C91A3",
  Savings: "#A9BEC8",
  Transfers: "#7E8C94",
  Income: "#9BC5D4",
  Refunds: "#BBCCD5",
  Other: "#A4A4AC",
};

export function categoryColor(category: string): string {
  return Object.prototype.hasOwnProperty.call(CATEGORY_COLORS, category)
    ? CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS]
    : CATEGORY_COLORS.Other;
}
