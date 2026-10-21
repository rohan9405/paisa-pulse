import type { CategoryRule, PaymentMethod, TxnKind } from "./types";

export const CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Transport",
  "Shopping",
  "Entertainment",
  "Subscriptions",
  "Bills & Utilities",
  "Rent & Housing",
  "Health",
  "Travel",
  "Education",
  "Personal Care",
  "Gifts & Donations",
  "Investments",
  "Savings",
  "Transfers",
  "Income",
  "Refunds",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number] | string;

export const CATEGORY_EMOJI: Record<string, string> = {
  "Food & Dining": "🍜",
  Groceries: "🛒",
  Transport: "🛺",
  Shopping: "🛍️",
  Entertainment: "🎬",
  Subscriptions: "📺",
  "Bills & Utilities": "💡",
  "Rent & Housing": "🏠",
  Health: "💊",
  Travel: "✈️",
  Education: "📚",
  "Personal Care": "💇",
  "Gifts & Donations": "🎁",
  Investments: "📈",
  Savings: "🏦",
  Transfers: "🔁",
  Income: "💰",
  Refunds: "↩️",
  Other: "✨",
};

export function categoryEmoji(c: string): string {
  return CATEGORY_EMOJI[c] ?? "✨";
}

const R = (pattern: string, category: string, kind?: TxnKind): Omit<CategoryRule, "id"> => ({
  pattern,
  category,
  kind,
  priority: 0,
  builtIn: true,
});

/** Built-in merchant rules. Users can add their own (priority > 0 wins). */
export const DEFAULT_RULES: Omit<CategoryRule, "id">[] = [
  ...["swiggy", "zomato", "dominos", "domino's", "mcdonald", "kfc", "starbucks", "chaayos", "haldiram", "barbeque nation", "eatsure", "cafe", "restaurant", "dhaba"].map((p) => R(p, "Food & Dining")),
  ...["bigbasket", "blinkit", "zepto", "instamart", "dmart", "jiomart", "more retail", "reliance fresh", "nature's basket", "kirana"].map((p) => R(p, "Groceries")),
  ...["uber", "ola", "rapido", "namma yatri", "metro", "irctc", "fastag", "indian oil", "hp petrol", "bharat petroleum", "bpcl", "petrol", "redbus"].map((p) => R(p, "Transport")),
  ...["amazon", "flipkart", "myntra", "ajio", "nykaa", "meesho", "tata cliq", "croma", "decathlon", "ikea"].map((p) => R(p, "Shopping")),
  ...["bookmyshow", "pvr", "inox", "steam", "playstation"].map((p) => R(p, "Entertainment")),
  ...["netflix", "spotify", "hotstar", "jiocinema", "prime video", "youtube premium", "apple.com/bill", "google play", "sonyliv", "zee5"].map((p) => R(p, "Subscriptions")),
  ...["airtel", "jio", "vodafone", "vi prepaid", "bescom", "tata power", "adani electricity", "mahanagar gas", "act fibernet", "electricity", "broadband", "bbps"].map((p) => R(p, "Bills & Utilities")),
  ...["rent", "nobroker", "society maintenance"].map((p) => R(p, "Rent & Housing")),
  ...["apollo", "pharmeasy", "1mg", "netmeds", "practo", "medplus", "hospital", "clinic", "cult.fit", "cultfit"].map((p) => R(p, "Health")),
  ...["makemytrip", "goibibo", "cleartrip", "indigo", "air india", "vistara", "akasa", "oyo", "airbnb", "booking.com"].map((p) => R(p, "Travel")),
  ...["udemy", "coursera", "byju", "unacademy", "school fee", "college"].map((p) => R(p, "Education")),
  ...["urban company", "salon", "lakme"].map((p) => R(p, "Personal Care")),
  ...["zerodha", "groww", "kuvera", "coin by zerodha", "upstox", "indmoney", "mutual fund", "sip ", "nps ", "ppf"].map((p) => R(p, "Investments", "investment")),
  ...["self transfer", "own account", "to self", "sweep"].map((p) => R(p, "Transfers", "transfer")),
  ...["salary", "sal cr", "payroll", "interest credit", "int.pd"].map((p) => R(p, "Income", "income")),
];

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface CategorizeResult {
  category: string;
  kind?: TxnKind;
  ruleId?: string;
}

/** Highest-priority matching rule wins; ties → longest pattern (more specific). */
export function categorize(text: string, rules: CategoryRule[]): CategorizeResult | null {
  const hay = ` ${normalize(text)} `;
  let best: CategoryRule | null = null;
  for (const r of rules) {
    const p = normalize(r.pattern);
    if (!p) continue;
    if (!matchesPattern(hay, p)) continue;
    if (!best || r.priority > best.priority || (r.priority === best.priority && p.length > normalize(best.pattern).length)) best = r;
  }
  return best ? { category: best.category, kind: best.kind, ruleId: best.id } : null;
}

/** Short patterns (≤4 chars like "ola", "jio") must match on word boundaries to avoid "coca-cola" → Transport. */
function matchesPattern(hay: string, p: string): boolean {
  if (p.length > 4) return hay.includes(p);
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(hay);
}

/**
 * Pull a human merchant name out of a bank narration.
 *  "UPI/412345678901/SWIGGY/swiggy@icici/Payment" → "Swiggy"
 *  "UPI-ZOMATO LTD-zomato@hdfcbank-HDFC0000001-..." → "Zomato Ltd"
 *  "POS 4321XXXX DMART AVENUE MUMBAI" → "Dmart Avenue Mumbai"
 */
export function extractMerchant(narration: string): string {
  let s = narration.trim();
  if (!s) return "Unknown";
  const upi = /^upi[\/\- :]/i.test(s);
  if (upi) {
    const parts = s.split(/[\/\-]/).map((p) => p.trim()).filter(Boolean);
    const candidate = parts.slice(1).find((p) => /[a-z]/i.test(p) && !/@/.test(p) && !/^(upi|p2m|p2a|dr|cr|payment|pay|collect|ref|na)$/i.test(p) && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(p));
    if (candidate) s = candidate;
  } else {
    s = s
      .replace(/^(pos|ecom|neft|imps|rtgs|ach|nach|atm|bil|bbps|vps|ipay)\b[\s\/\-:]*/i, "")
      .replace(/\b\d*x{2,}\d*\b|\b\d{4,}\b|\*+\d+/gi, "")
      .replace(/[\/\-]+/g, " ");
  }
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "Unknown";
  return titleCase(s.slice(0, 40));
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s.&])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export function detectMethod(narration: string): PaymentMethod {
  const n = narration.toLowerCase();
  if (/\bupi\b|@ok|@ybl|@paytm|@icici|@hdfc|@axl|@ibl/.test(n)) return "upi";
  if (/\b(pos|card|visa|mastercard|rupay|ecom)\b/.test(n)) return "card";
  if (/\b(atm|cash)\b/.test(n)) return "cash";
  if (/\b(neft|imps|rtgs|netbanking|net banking|nach|ach)\b/.test(n)) return "netbanking";
  if (/\b(paytm wallet|amazon pay|mobikwik|wallet)\b/.test(n)) return "wallet";
  return "other";
}
