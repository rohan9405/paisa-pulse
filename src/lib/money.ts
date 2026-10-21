/**
 * Money is always stored as integer paise (₹1 = 100 paise).
 * Never do arithmetic on floating-point rupees.
 */
export type Paise = number;

export function assertPaise(n: number): Paise {
  if (!Number.isSafeInteger(n)) throw new Error(`Not an integer paise amount: ${n}`);
  return n;
}

/** Group an integer string the Indian way: 12,34,567 */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

export interface FormatOptions {
  /** Show paise even when zero. Default: only when non-zero. */
  decimals?: "auto" | "always" | "never";
  /** Prefix + for positive numbers. */
  sign?: boolean;
  /** Compact notation (₹1.2L, ₹3.4Cr, ₹12.5K). */
  compact?: boolean;
}

/** Format paise as Indian rupees: ₹1,23,456.50 */
export function formatINR(p: Paise, opts: FormatOptions = {}): string {
  const neg = p < 0;
  const abs = Math.abs(Math.trunc(p));
  const prefix = neg ? "−" : opts.sign && p > 0 ? "+" : "";
  if (opts.compact) {
    const rupees = abs / 100;
    let s: string;
    if (rupees >= 1e7) s = `${trim(rupees / 1e7)}Cr`;
    else if (rupees >= 1e5) s = `${trim(rupees / 1e5)}L`;
    else if (rupees >= 1e3) s = `${trim(rupees / 1e3)}K`;
    else s = String(Math.round(rupees));
    return `${prefix}₹${s}`;
  }
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const mode = opts.decimals ?? "auto";
  const showPaise = mode === "always" || (mode === "auto" && paise !== 0);
  const frac = showPaise ? `.${String(paise).padStart(2, "0")}` : "";
  return `${prefix}₹${groupIndian(String(rupees))}${frac}`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Parse a user- or bank-supplied amount string into paise without floats.
 * Accepts: "1,23,456.78", "₹ 500", "Rs. 99.5", "INR 10", "-250", "(250)", "250 Dr", "250 CR".
 * Returns a signed value: negative for debit markers / parentheses / leading minus.
 * Returns null if the string isn't a valid amount (e.g. more than 2 decimals, letters).
 */
export function parseAmountToPaise(raw: string | number | null | undefined): Paise | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;

  const drcr = s.match(/\s*\b(dr|cr)\.?$/i);
  if (drcr) {
    if (drcr[1].toLowerCase() === "dr") negative = true;
    s = s.slice(0, drcr.index).trim();
  }
  if (/^\(.*\)$/.test(s)) {
    negative = !negative;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "");
  // Commas only as thousands separators (Indian or western grouping).
  if (!/^\d{1,3}(,\d{2,3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return null;
  s = s.replace(/,/g, "");
  const [intPart, fracPart = ""] = s.split(".");
  const paise = Number(intPart || "0") * 100 + Number(fracPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) return null;
  return negative ? -paise : paise;
}

/** Rupee input (as typed into a form) → paise. Returns null if invalid or not positive. */
export function rupeesInputToPaise(input: string): Paise | null {
  const p = parseAmountToPaise(input);
  if (p === null || p <= 0) return null;
  return p;
}

export function paiseToRupeeInput(p: Paise): string {
  const abs = Math.abs(p);
  const r = Math.floor(abs / 100);
  const f = abs % 100;
  return `${p < 0 ? "-" : ""}${r}${f ? "." + String(f).padStart(2, "0") : ""}`;
}
