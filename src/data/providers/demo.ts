/**
 * Demo provider: deterministic, fictional Indian transactions relative to
 * "today". Every row is tagged providerId "demo" and labelled as fictional.
 * This is NOT live bank data and must never be presented as such.
 */
import { type DateKey, addMonths, dueDateInMonth, eachDay, monthKey, parseKey, startOfMonth } from "@/lib/dates";
import type { BudgetPlan, Commitment, Profile, Recurring, Transaction, TxnKind, PaymentMethod } from "@/lib/types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rupees = (r: number) => Math.round(r * 100);

export const DEMO_COMMITMENTS: Commitment[] = [
  { id: "c-rent", name: "Rent", kind: "bill", tag: "Rent", amountPaise: rupees(22000), dueDay: 1, matchHint: "ramesh.k@okaxis" },
  { id: "c-sip", name: "Index fund SIP", kind: "investment", tag: "SIP", amountPaise: rupees(8000), dueDay: 5, matchHint: "groww" },
  { id: "c-stocks", name: "Stocks top-up", kind: "investment", tag: "Stocks", amountPaise: rupees(3000), dueDay: 7, matchHint: "zerodha" },
  { id: "c-wifi", name: "Airtel Xstream Fiber", kind: "bill", tag: "Phone & internet", amountPaise: rupees(1178), dueDay: 8, matchHint: "airtel" },
  { id: "c-rd", name: "Emergency fund RD", kind: "savings", tag: "RD / FD", amountPaise: rupees(4000), dueDay: 10, matchHint: "recurring deposit" },
  { id: "c-power", name: "Electricity (BESCOM)", kind: "bill", tag: "Utility", amountPaise: rupees(1800), dueDay: 14, matchHint: "bescom" },
  { id: "c-phone", name: "Jio postpaid", kind: "bill", tag: "Phone & internet", amountPaise: rupees(599), dueDay: 24, matchHint: "jio" },
];

const DEMO_PAYMENT: Record<string, { merchant: string; category: string; payee?: string }> = {
  "c-rent": { merchant: "Ramesh K", category: "Bills", payee: "ramesh.k@okaxis" },
  "c-sip": { merchant: "Groww", category: "Investments" },
  "c-stocks": { merchant: "Zerodha", category: "Investments" },
  "c-wifi": { merchant: "Airtel", category: "Bills" },
  "c-rd": { merchant: "Recurring deposit", category: "Savings" },
  "c-power": { merchant: "Bescom", category: "Bills" },
  "c-phone": { merchant: "Jio", category: "Bills" },
};

type Spec = { merchant: string; category: string; min: number; max: number; method?: PaymentMethod };
const BREAKFAST: Spec[] = [
  { merchant: "Chaayos", category: "Food & Dining", min: 120, max: 260 },
  { merchant: "Third Wave Coffee", category: "Food & Dining", min: 180, max: 340 },
  { merchant: "Udupi Grand", category: "Food & Dining", min: 60, max: 140 },
];
const LUNCH: Spec[] = [
  { merchant: "Swiggy", category: "Food & Dining", min: 180, max: 520 },
  { merchant: "Zomato", category: "Food & Dining", min: 200, max: 640 },
  { merchant: "Office canteen", category: "Food & Dining", min: 80, max: 160 },
];
const COMMUTE: Spec[] = [
  { merchant: "Rapido", category: "Transport", min: 45, max: 140 },
  { merchant: "Namma Metro", category: "Transport", min: 30, max: 60 },
  { merchant: "Uber", category: "Transport", min: 160, max: 420 },
  { merchant: "Ola", category: "Transport", min: 140, max: 380 },
];
const GROCERY: Spec[] = [
  { merchant: "Blinkit", category: "Groceries", min: 220, max: 900 },
  { merchant: "Zepto", category: "Groceries", min: 180, max: 750 },
  { merchant: "BigBasket", category: "Groceries", min: 700, max: 2200 },
];
const DINNER: Spec[] = [
  { merchant: "Swiggy", category: "Food & Dining", min: 260, max: 780 },
  { merchant: "Zomato", category: "Food & Dining", min: 280, max: 820 },
  { merchant: "Meghana Foods", category: "Food & Dining", min: 450, max: 1100, method: "card" },
];
const BIG: Spec[] = [
  { merchant: "Amazon", category: "Shopping", min: 1800, max: 4800, method: "card" },
  { merchant: "Croma", category: "Shopping", min: 2500, max: 5500, method: "card" },
  { merchant: "Apollo Pharmacy", category: "Health", min: 600, max: 1800 },
];
const WEEKEND: Spec[] = [
  { merchant: "PVR Cinemas", category: "Entertainment", min: 450, max: 900, method: "card" },
  { merchant: "Toit Brewpub", category: "Food & Dining", min: 1400, max: 3200, method: "card" },
  { merchant: "Myntra", category: "Shopping", min: 799, max: 2499, method: "card" },
  { merchant: "Amazon", category: "Shopping", min: 299, max: 1899, method: "card" },
  { merchant: "Decathlon", category: "Shopping", min: 599, max: 2199, method: "card" },
  { merchant: "Urban Company", category: "Personal Care", min: 499, max: 1299 },
];

export interface DemoDataset {
  profile: Profile;
  plan: BudgetPlan;
  txns: Transaction[];
  recurring: Recurring[];
}

export function generateDemoData(today: DateKey, now = Date.now()): DemoDataset {
  const rand = rng(Number(today.replace(/-/g, "")));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const amt = (s: Spec) => Math.round(s.min + rand() * (s.max - s.min)) * 100;

  const trackingStart = startOfMonth(addMonths(monthKey(today), -1) + "-01");
  const plan: BudgetPlan = { id: "plan-demo", effectiveFrom: trackingStart, incomePaise: rupees(84000), commitments: DEMO_COMMITMENTS, createdAt: now };
  const profile: Profile = { id: "me", name: "Aarav (demo)", trackingStart, openingAdjustmentPaise: 0, onboardedAt: now, manuallyPaid: [] };

  const txns: Transaction[] = [];
  let seq = 0;
  const add = (date: DateKey, merchant: string, category: string, amountPaise: number, kind: TxnKind = "expense", extra: Partial<Transaction> = {}) => {
    seq++;
    const t: Transaction = {
      id: `demo-${seq}`,
      date,
      merchant,
      category,
      amountPaise,
      kind,
      method: extra.method ?? "upi",
      source: { providerId: "demo", importedAt: now, raw: "DEMO — fictional transaction", externalRef: `DEMO${String(seq).padStart(5, "0")}` },
      createdAt: now + seq,
      updatedAt: now + seq,
      ...extra,
    };
    txns.push(t);
    return t;
  };

  const { d: todayDay } = parseKey(today);
  for (const day of eachDay(trackingStart, today)) {
    const { d } = parseKey(day);
    const dow = new Date(day + "T00:00:00Z").getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const isToday = day === today;
    const mk = monthKey(day);

    // Monthly: salary, commitments on due dates, own-account transfer.
    if (d === 1) add(day, "Acme Technologies Pvt Ltd", "Income", rupees(84000), "income", { method: "netbanking", note: "Salary (demo)" });
    for (const c of DEMO_COMMITMENTS) {
      if (dueDateInMonth(mk, c.dueDay) !== day) continue;
      const variance = c.id === "c-power" ? (mk === monthKey(today) ? 1.12 : 0.94) : 1;
      const pay = DEMO_PAYMENT[c.id];
      add(day, pay.merchant, pay.category, Math.round(c.amountPaise * variance), c.kind === "bill" ? "expense" : "investment", {
        tag: c.tag,
        payee: pay.payee,
        method: c.kind === "bill" ? "upi" : "netbanking",
      });
    }
    if (d === 2) add(day, "Self transfer to SBI savings", "Transfers", rupees(15000), "transfer", { method: "netbanking" });
    if (d === 18) add(day, "Netflix", "Subscriptions", rupees(649), "expense", { tag: "OTT", method: "card", recurring: true });

    // Daily life.
    if (!weekend || rand() < 0.4) add(day, ...specArgs(pick(BREAKFAST)));
    if (isToday && todayDay % 2 === 0) continue; // keep today light so quick-add has room
    if (!weekend) {
      add(day, ...specArgs(pick(COMMUTE)));
      if (rand() < 0.75) add(day, ...specArgs(pick(LUNCH)));
      if (rand() < 0.6) add(day, ...specArgs(pick(COMMUTE)));
    }
    if (!isToday && rand() < 0.35) add(day, ...specArgs(pick(GROCERY)));
    if (!isToday && rand() < 0.22) add(day, ...specArgs(pick(DINNER)));
    if (!isToday && rand() < 0.04) add(day, ...specArgs(pick(BIG)));
    if (!isToday && weekend) {
      add(day, ...specArgs(pick(WEEKEND)));
      if (rand() < 0.5) add(day, ...specArgs(pick(LUNCH)));
    }
  }

  // A returned Myntra order (refund linked) and an orphan cashback (needs review).
  const myntra = txns.find((t) => t.merchant === "Myntra" && t.date < today);
  if (myntra) {
    add(nextDay(myntra.date, today, 4), "Myntra", "Refunds", myntra.amountPaise, "refund", { refundOf: myntra.id, method: "card", note: "Return refund (demo)" });
  }
  add(nextDay(trackingStart, today, 12), "Amazon Pay cashback", "Refunds", rupees(150), "refund", {
    needsReview: true,
    reviewReason: "No matching expense found for this refund",
    method: "wallet",
  });

  const recurring: Recurring[] = [
    { id: "rec-netflix", name: "Netflix", amountPaise: rupees(649), frequency: "monthly", dueDay: 18, category: "Subscriptions", tag: "OTT", source: "mandate", status: "active", createdAt: now, updatedAt: now },
    { id: "rec-lic", name: "LIC premium", amountPaise: rupees(2400), frequency: "monthly", dueDay: dayAfter(today, 3), category: "Bills", tag: "Insurance", source: "mandate", status: "active", createdAt: now, updatedAt: now },
  ];
  return { profile, plan, txns: txns.filter((t) => t.date <= today), recurring };

  function specArgs(s: Spec): [string, string, number, TxnKind, Partial<Transaction>] {
    return [s.merchant, s.category, amt(s), "expense", { method: s.method ?? "upi" }];
  }
}

/** Day of month `n` days after `from` (so the demo always has something coming up). */
function dayAfter(from: DateKey, n: number): number {
  return parseKey(nextDay(from, "9999-12-31", n)).d;
}

function nextDay(from: DateKey, max: DateKey, n: number): DateKey {
  const d = new Date(from + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  const k = d.toISOString().slice(0, 10);
  return k > max ? max : k;
}
