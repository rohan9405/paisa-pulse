import type { CategoryRule, PaymentMethod, TxnKind } from "./types";

export const CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Transport",
  "Shopping",
  "Entertainment",
  "Subscriptions",
  "Bills",
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
  Bills: "🧾",
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

/** Categories that are never "expenses": money you keep. Left out of expense breakdowns. */
export const NOT_EXPENSE = ["Investments", "Savings"];
/** Set aside before the daily budget unless you change it in Settings. */
export const DEFAULT_SET_ASIDE = ["Bills", "Investments", "Savings"];
/** Categories that can be set aside. */
export const SET_ASIDE_OPTIONS = ["Bills", "Investments", "Savings", "Subscriptions", "Education"];

/** Suggested tags per category. Any text works as a tag; these are just one tap away. */
export const TAGS: Record<string, string[]> = {
  Bills: ["Rent", "Utility", "Phone & internet", "EMI", "Insurance", "Maintenance"],
  Investments: ["SIP", "Stocks", "Mutual fund", "NPS / PPF"],
  Savings: ["RD / FD", "Emergency fund"],
  Income: ["Salary", "Dividend income", "Interest"],
  Subscriptions: ["OTT", "Music", "Cloud"],
};

/** Tag → icon for reminders and pills. */
export function tagEmoji(tag: string | undefined, category: string): string {
  const t = (tag ?? "").toLowerCase();
  if (t === "rent") return "🏠";
  if (t === "utility") return "💡";
  if (t === "phone & internet") return "📶";
  if (t === "emi") return "🏦";
  if (t === "insurance") return "🛡️";
  if (t === "sip" || t === "mutual fund" || t === "stocks") return "📈";
  if (t === "dividend income") return "💸";
  return categoryEmoji(category);
}

const R = (pattern: string, category: string, kind?: TxnKind, tag?: string): Omit<CategoryRule, "id"> => ({
  pattern,
  category,
  kind,
  tag,
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
  ...["bescom", "tata power", "adani electricity", "msedcl", "tneb", "bses", "electricity", "mahanagar gas", "indraprastha gas", "water board", "bbps"].map((p) => R(p, "Bills", undefined, "Utility")),
  ...["airtel", "jio", "vodafone", "vi prepaid", "act fibernet", "broadband", "hathway", "tata play"].map((p) => R(p, "Bills", undefined, "Phone & internet")),
  ...["rent", "nobroker"].map((p) => R(p, "Bills", undefined, "Rent")),
  ...["society maintenance", "mygate", "nobrokerhood"].map((p) => R(p, "Bills", undefined, "Maintenance")),
  ...["emi", "loan repayment", "bajaj finance", "home loan"].map((p) => R(p, "Bills", undefined, "EMI")),
  ...["lic", "insurance premium", "hdfc life", "icici pru", "star health", "acko", "policybazaar"].map((p) => R(p, "Bills", undefined, "Insurance")),
  ...["apollo", "pharmeasy", "1mg", "netmeds", "practo", "medplus", "hospital", "clinic", "cult.fit", "cultfit"].map((p) => R(p, "Health")),
  // Any merchant with "pharmacy" / "chemist" in the name. Payments only, so a "… Pharma" dividend stays a dividend.
  ...["pharmacy", "pharma", "chemist", "medical store", "medicals"].map((p) => ({ ...R(p, "Health"), direction: "out" as const })),
  ...["makemytrip", "goibibo", "cleartrip", "indigo", "air india", "vistara", "akasa", "oyo", "airbnb", "booking.com"].map((p) => R(p, "Travel")),
  ...["udemy", "coursera", "byju", "unacademy", "school fee", "college"].map((p) => R(p, "Education")),
  ...["urban company", "salon", "lakme"].map((p) => R(p, "Personal Care")),
  // Indian Clearing Corporation settles BSE StAR MF / exchange purchases ("INDIAN CLEARING CORP" on bank SMS).
  ...["sip ", "mutual fund", "bse star mf", "bse ltd", "cams", "kfintech", "kuvera", "coin by zerodha", "nach mf", "indian clearing", "iccl", "clearing corp"].map((p) => R(p, "Investments", "investment", "SIP")),
  ...["zerodha", "groww", "upstox", "indmoney", "indstocks", "angel one", "dhan"].map((p) => R(p, "Investments", "investment", "Stocks")),
  ...["nps ", "ppf"].map((p) => R(p, "Investments", "investment", "NPS / PPF")),
  ...["recurring deposit", "fixed deposit", " rd ", " fd "].map((p) => R(p, "Savings", "investment", "RD / FD")),
  ...["self transfer", "own account", "to self", "sweep"].map((p) => R(p, "Transfers", "transfer")),
  ...["salary", "sal cr", "payroll"].map((p) => R(p, "Income", "income", "Salary")),
  ...["interest credit", "int.pd", "int pd", "interest paid"].map((p) => R(p, "Income", "income", "Interest")),
  // Dividends arrive as ACH credits, e.g. "ACH C- ITC LTD" / "ACH CR".
  ...["dividend", "ach c-", "ach-cr", "achcr"].map((p) => R(p, "Income", "income", "Dividend income")),
  // Any credit with "ACH" in it ("ACH ITC LTD DIV"). Credits only: ACH debits are SIPs and EMIs.
  { ...R("ach", "Income", "income", "Dividend income"), direction: "in" as const },
];

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface CategorizeResult {
  category: string;
  kind?: TxnKind;
  tag?: string;
  ruleId?: string;
}

/**
 * A rule for this exact payee (UPI ID) wins outright. Otherwise the
 * highest-priority text rule wins; ties → longest pattern (more specific).
 */
export function categorize(text: string, rules: CategoryRule[], payee?: string, context?: { merchant?: string; direction?: "in" | "out" }): CategorizeResult | null {
  rules = rules.filter((r) => !r.direction || !context?.direction || r.direction === context.direction);
  // A user's matching rule always wins, even over a remote priority of 100.
  if (rules.some((r) => !r.builtIn)) {
    const personal = categorize(text, rules.filter((r) => !r.builtIn).map((r) => ({ ...r, builtIn: true })), payee, context);
    if (personal) return personal;
  }
  const pay = payee ? normalize(payee) : "";
  if (pay) {
    const byPayee = rules.filter((r) => r.payee && normalize(r.payee) === pay).sort((a, b) => b.priority - a.priority)[0];
    if (byPayee) return { category: byPayee.category, kind: byPayee.kind, tag: byPayee.tag, ruleId: byPayee.id };
  }
  const exact = rules.filter((r) => r.merchant && !pay && normalize(r.merchant) === normalize(context?.merchant ?? text)).sort((a, b) => b.priority - a.priority)[0];
  if (exact) return { category: exact.category, kind: exact.kind, tag: exact.tag, ruleId: exact.id };
  const hay = ` ${normalize(text)} `;
  let best: CategoryRule | null = null;
  for (const r of rules) {
    if (r.payee || r.merchant) continue;
    const p = normalize(r.pattern);
    if (!p) continue;
    if (!matchesPattern(hay, p)) continue;
    if (!best || r.priority > best.priority || (r.priority === best.priority && p.length > normalize(best.pattern).length)) best = r;
  }
  return best ? { category: best.category, kind: best.kind, tag: best.tag, ruleId: best.id } : null;
}

/** Kind that goes with a category for money going out. */
export function outflowKind(category: string): TxnKind {
  return category === "Investments" || category === "Savings" ? "investment" : category === "Transfers" ? "transfer" : "expense";
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
