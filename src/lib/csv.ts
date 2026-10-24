/**
 * CSV import: parse → map columns → validate → detect duplicates → preview.
 * Nothing is imported silently: every row ends up "valid", "duplicate" or
 * "invalid" with a reason, and the user decides what to import.
 */
import Papa from "papaparse";
import { type DateKey, isDateKey, makeKey } from "./dates";
import { type Paise, parseAmountToPaise } from "./money";
import { categorize, detectMethod, extractMerchant, normalize, outflowKind } from "./categorize";
import { findPayee } from "./sms";
import type { CategoryRule, PaymentMethod, TxnKind } from "./types";

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  /** Lines skipped before the header (bank preamble). */
  skippedPreamble: number;
}

/**
 * Parse CSV text. Many Indian bank exports put account details above the real
 * header, so we pick the first row that looks like a header (≥3 non-empty
 * cells containing a date-ish and amount-ish column name).
 */
export function parseCsv(text: string): ParsedCsv {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const all = (res.data as string[][]).map((r) => r.map((c) => (c ?? "").trim()));
  let headerIdx = all.findIndex((r) => {
    const cells = r.filter(Boolean).map((c) => c.toLowerCase());
    return cells.length >= 3 && cells.some((c) => /date/.test(c)) && cells.some((c) => /amount|debit|withdrawal|credit|deposit|dr|cr/.test(c));
  });
  if (headerIdx < 0) headerIdx = 0;
  const headers = (all[headerIdx] ?? []).map((h, i) => h || `Column ${i + 1}`);
  const rows = all.slice(headerIdx + 1).filter((r) => r.some((c) => c !== ""));
  return { headers, rows, skippedPreamble: headerIdx };
}

export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "DD-MMM-YYYY";
export const DATE_FORMATS: DateFormat[] = ["DD/MM/YYYY", "YYYY-MM-DD", "DD-MMM-YYYY", "MM/DD/YYYY"];

export interface ColumnMapping {
  date: number;
  dateFormat: DateFormat;
  description: number;
  /** "signed": one amount column, negative (or Dr) = money out.
   *  "split": separate debit and credit columns.
   *  "type": amount column + a Dr/Cr type column. */
  amountMode: "signed" | "split" | "type";
  amount?: number;
  debit?: number;
  credit?: number;
  type?: number;
  /** For "signed" mode: whether positive numbers mean money out (some card statements). */
  positiveIsDebit?: boolean;
  reference?: number;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/** Parse a bank date in the user's chosen format. Returns null if invalid (e.g. 31/02). */
export function parseDate(raw: string, fmt: DateFormat): DateKey | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match: RegExpExecArray | null;
  switch (fmt) {
    case "DD/MM/YYYY":
      match = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})(?:\s.*)?$/.exec(s);
      if (!match) return null;
      [d, m, y] = [Number(match[1]), Number(match[2]), fullYear(match[3])];
      break;
    case "MM/DD/YYYY":
      match = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})(?:\s.*)?$/.exec(s);
      if (!match) return null;
      [m, d, y] = [Number(match[1]), Number(match[2]), fullYear(match[3])];
      break;
    case "YYYY-MM-DD":
      match = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[\sT].*)?$/.exec(s);
      if (!match) return null;
      [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
      break;
    case "DD-MMM-YYYY":
      match = /^(\d{1,2})[\s\/\-.]([A-Za-z]{3,4})[\s\/\-.,]+(\d{2}|\d{4})(?:\s.*)?$/.exec(s);
      if (!match) return null;
      d = Number(match[1]);
      m = MONTHS[match[2].toLowerCase()];
      y = fullYear(match[3]);
      if (!m) return null;
      break;
  }
  const key = makeKey(y, m, d);
  return isDateKey(key) ? key : null;
}

/** Guess a mapping from header names; the user always confirms it. */
export function guessMapping(headers: string[], sampleRows: string[][]): ColumnMapping {
  const h = headers.map((x) => x.toLowerCase());
  const find = (...res: RegExp[]) => {
    for (const re of res) {
      const i = h.findIndex((x) => re.test(x));
      if (i >= 0) return i;
    }
    return -1;
  };
  const date = find(/^(txn |transaction |tran )?date$/, /date/);
  const description = find(/narration|description|particulars|details|remarks|merchant/);
  const debit = find(/withdrawal|debit|dr\.? ?amount|^dr$/);
  const credit = find(/deposit|credit|cr\.? ?amount|^cr$/);
  const amount = find(/^amount|amount|amt/);
  const type = find(/^type$|dr\s*\/\s*cr|cr\s*\/\s*dr|txn type/);
  const reference = find(/ref|chq|cheque|utr|transaction id/);

  const sample = date >= 0 ? sampleRows.map((r) => r[date]).filter(Boolean).slice(0, 20) : [];
  const dateFormat = DATE_FORMATS.find((f) => sample.length > 0 && sample.every((s) => parseDate(s, f))) ?? "DD/MM/YYYY";

  const base = { date: Math.max(0, date), dateFormat, description: Math.max(0, description), reference: reference >= 0 && reference !== date ? reference : undefined };
  if (debit >= 0 && credit >= 0 && debit !== credit) return { ...base, amountMode: "split", debit, credit };
  if (amount >= 0 && type >= 0 && amount !== type) return { ...base, amountMode: "type", amount, type };
  return { ...base, amountMode: "signed", amount: Math.max(0, amount), positiveIsDebit: false };
}

export interface CandidateRow {
  rowNumber: number; // 1-based, relative to data rows
  status: "valid" | "duplicate" | "invalid";
  errors: string[];
  duplicateReason?: string;
  date?: DateKey;
  amountPaise?: Paise;
  direction?: "out" | "in";
  description: string;
  merchant: string;
  reference?: string;
  kind?: TxnKind;
  category?: string;
  tag?: string;
  payee?: string;
  method?: PaymentMethod;
  fingerprint?: string;
  raw: string[];
}

/** Stable identity for duplicate detection. Bank reference wins when present. */
export function fingerprint(t: { date: DateKey; amountPaise: Paise; direction: "out" | "in"; description: string; reference?: string }): string {
  if (t.reference && t.reference.replace(/[0\s]/g, "")) return `ref:${normalize(t.reference)}`;
  const desc = normalize(t.description).replace(/[^a-z0-9]/g, "").slice(0, 48);
  return `${t.date}|${t.direction}|${t.amountPaise}|${desc}`;
}

export function validateRows(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  opts: { existingFingerprints: Set<string>; rules: CategoryRule[] },
): CandidateRow[] {
  const seenInFile = new Map<string, number>();
  return parsed.rows.map((raw, i) => {
    const errors: string[] = [];
    const cell = (idx?: number) => (idx === undefined || idx < 0 ? "" : (raw[idx] ?? "").trim());
    const description = cell(mapping.description);
    const reference = cell(mapping.reference) || undefined;
    const dateRaw = cell(mapping.date);
    const date = dateRaw ? parseDate(dateRaw, mapping.dateFormat) : null;
    if (!dateRaw) errors.push("Missing date");
    else if (!date) errors.push(`Date "${dateRaw}" doesn't match ${mapping.dateFormat}`);

    let amountPaise: Paise | undefined;
    let direction: "out" | "in" | undefined;
    if (mapping.amountMode === "split") {
      const dr = cell(mapping.debit);
      const cr = cell(mapping.credit);
      const drP = dr ? parseAmountToPaise(dr) : 0;
      const crP = cr ? parseAmountToPaise(cr) : 0;
      if (drP === null) errors.push(`Debit "${dr}" isn't a valid amount`);
      if (crP === null) errors.push(`Credit "${cr}" isn't a valid amount`);
      if (drP !== null && crP !== null) {
        const d = Math.abs(drP), c = Math.abs(crP);
        if (d > 0 && c > 0) errors.push("Row has both debit and credit");
        else if (d > 0) [amountPaise, direction] = [d, "out"];
        else if (c > 0) [amountPaise, direction] = [c, "in"];
        else errors.push("No debit or credit amount");
      }
    } else {
      const a = cell(mapping.amount);
      const p = a ? parseAmountToPaise(a) : null;
      if (!a) errors.push("Missing amount");
      else if (p === null) errors.push(`Amount "${a}" isn't a valid amount`);
      else if (p === 0) errors.push("Amount is zero");
      else if (mapping.amountMode === "type") {
        const t = cell(mapping.type).toLowerCase();
        if (/^(dr|debit|d|withdrawal)\.?$/.test(t)) direction = "out";
        else if (/^(cr|credit|c|deposit)\.?$/.test(t)) direction = "in";
        else errors.push(`Type "${cell(mapping.type)}" isn't Dr/Cr`);
        amountPaise = Math.abs(p);
      } else {
        const out = mapping.positiveIsDebit ? p > 0 : p < 0;
        direction = out ? "out" : "in";
        amountPaise = Math.abs(p);
      }
    }
    if (!description) errors.push("Missing description");

    const base: CandidateRow = { rowNumber: i + 1, status: "invalid", errors, description, merchant: extractMerchant(description), reference, raw };
    if (errors.length || !date || amountPaise === undefined || !direction) return base;

    const fp = fingerprint({ date, amountPaise, direction, description, reference });
    const payee = findPayee(description);
    const rule = categorize(description, opts.rules, payee, { merchant: base.merchant, direction });
    let kind: TxnKind = direction === "out" ? "expense" : "income";
    if (rule?.kind && (rule.kind === "transfer" || (direction === "out" && !["income", "refund", "settlement"].includes(rule.kind)) || (direction === "in" && ["income", "refund", "settlement"].includes(rule.kind)))) kind = rule.kind;
    if (direction === "in" && rule?.category === "Settlement") kind = "settlement";
    if (direction === "in" && kind === "income" && /refund|reversal|cashback|rev\b/i.test(description)) kind = "refund";
    if (direction === "out" && kind === "expense" && rule && !rule.kind) kind = outflowKind(rule.category);
    const category = kind === "settlement" ? "Settlement" : kind === "refund" ? "Refunds" : kind === "income" ? (rule?.kind === "income" ? rule.category : "Income") : rule?.category ?? "Other";
    const tag = kind === "refund" || kind === "settlement" || kind === "transfer" ? undefined : rule?.tag;

    const row: CandidateRow = { ...base, status: "valid", date, amountPaise, direction, fingerprint: fp, kind, category, tag, payee, method: detectMethod(description) };
    if (opts.existingFingerprints.has(fp)) {
      row.status = "duplicate";
      row.duplicateReason = reference ? "Same bank reference already imported" : "Same date, amount and description already imported";
    } else if (seenInFile.has(fp)) {
      // Identical rows without a reference can be legitimate (two chais), so flag but let the user decide.
      row.status = reference ? "duplicate" : "valid";
      row.duplicateReason = `Identical to row ${seenInFile.get(fp)} in this file`;
    }
    if (!seenInFile.has(fp)) seenInFile.set(fp, i + 1);
    return row;
  });
}

export function summarizeCandidates(rows: CandidateRow[]) {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    possibleInFileDuplicates: rows.filter((r) => r.status === "valid" && r.duplicateReason).length,
  };
}
