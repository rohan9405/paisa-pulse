"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { type CandidateRow, type ColumnMapping, DATE_FORMATS, type DateFormat, type ParsedCsv, guessMapping, parseCsv, summarizeCandidates, validateRows } from "@/lib/csv";
import { formatDay } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { existingFingerprints, importCandidates, undoImport } from "@/data/repo";
import { useAppData, useStore } from "@/data/store";
import { Card, EmptyState, Field, PageHeader, Pill, SectionTitle, cx } from "@/components/ui";

const MAX_BYTES = 5 * 1024 * 1024;

export default function ImportPage() {
  const { db, mode } = useStore();
  const data = useAppData();
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [fps, setFps] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const [show, setShow] = useState<"all" | "valid" | "duplicate" | "invalid">("all");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; imported: number; skipped: number; invalid: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (parsed && mapping && data ? validateRows(parsed, mapping, { existingFingerprints: fps, rules: data.rules }) : []), [parsed, mapping, fps, data]);
  // User overrides: include a flagged duplicate, or exclude a valid row.
  const finalRows: CandidateRow[] = useMemo(
    () =>
      rows.map((r) => {
        const o = overrides[r.rowNumber];
        if (o === undefined || r.status === "invalid") return r;
        return { ...r, status: o ? "valid" : "duplicate", duplicateReason: o ? r.duplicateReason : "Excluded by you" };
      }),
    [rows, overrides],
  );
  const summary = summarizeCandidates(finalRows);

  const onFile = async (f: File | undefined) => {
    setError(null);
    setResult(null);
    setOverrides({});
    if (!f) return;
    if (f.size > MAX_BYTES) return setError("File is larger than 5 MB. Split the statement into smaller date ranges.");
    if (!/\.(csv|txt)$/i.test(f.name) && f.type && !/csv|text/.test(f.type)) return setError("Please choose a .csv file. For Excel statements, use “Save as CSV” first.");
    try {
      const text = await f.text();
      const p = parseCsv(text);
      if (p.rows.length === 0) return setError("No data rows found in this file.");
      if (p.headers.length < 2) return setError("Couldn't find columns — is this a comma-separated file?");
      setParsed(p);
      setMapping(guessMapping(p.headers, p.rows));
      setFileName(f.name);
      if (db) setFps(await existingFingerprints(db));
    } catch {
      setError("Couldn't read that file.");
    }
  };

  const doImport = async () => {
    if (!db) return;
    setBusy(true);
    const batch = await importCandidates(db, finalRows, fileName);
    setResult({ id: batch.id, imported: batch.importedCount, skipped: batch.skippedDuplicates, invalid: batch.invalidCount });
    setParsed(null);
    setMapping(null);
    setBusy(false);
  };

  if (mode === "demo") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader screen="import" title="Import CSV" />
        <EmptyState emoji="🎭" title="CSV import is for personal mode" body="Demo mode only holds fictional data. Switch to personal mode to import your own bank statement — it stays separate from the demo." />
      </div>
    );
  }

  const col = (k: keyof ColumnMapping, label: string, optional = false) =>
    parsed &&
    mapping && (
      <Field label={label}>
        <select
          className="input text-sm"
          value={(mapping[k] as number | undefined) ?? -1}
          onChange={(e) => setMapping({ ...mapping, [k]: Number(e.target.value) < 0 ? undefined : Number(e.target.value) })}
          aria-label={label}
        >
          {optional && <option value={-1}>— none —</option>}
          {parsed.headers.map((h, i) => (
            <option key={i} value={i}>
              {h} {parsed.rows[0]?.[i] ? `· e.g. ${parsed.rows[0][i].slice(0, 18)}` : ""}
            </option>
          ))}
        </select>
      </Field>
    );

  const visible = finalRows.filter((r) => show === "all" || r.status === show);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader screen="import" title="Import CSV" subtitle="Bank or card statement → transactions. Parsed only in this browser." />

      {result && (
        <Card className="mb-4 border-lime/30 bg-lime/[0.06]" data-testid="import-result">
          <div className="font-semibold">✅ Imported {result.imported} transactions</div>
          <div className="mt-1 text-sm text-ink-300">
            Skipped {result.skipped} duplicate{result.skipped === 1 ? "" : "s"} and {result.invalid} invalid row{result.invalid === 1 ? "" : "s"}.
          </div>
          <div className="mt-3 flex gap-2">
            <Link href="/transactions" className="btn-primary">
              View activity
            </Link>
            <button className="btn-ghost" onClick={async () => db && (await undoImport(db, result.id), setResult(null))}>
              Undo import
            </button>
          </div>
        </Card>
      )}

      {!parsed && (
        <label className="flex cursor-pointer flex-col items-center rounded-3xl border-2 border-dashed border-white/10 px-6 py-12 text-center transition hover:border-lime/40">
          <span className="text-4xl">📄</span>
          <span className="mt-3 font-semibold">Choose a CSV statement</span>
          <span className="mt-1 max-w-sm text-sm text-ink-400">Every bank exports differently — you'll confirm which column is which before anything is imported.</span>
          <input type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} data-testid="csv-input" />
        </label>
      )}
      {error && (
        <p className="mt-3 text-sm text-coral" role="alert">
          {error}
        </p>
      )}

      {parsed && mapping && (
        <>
          <SectionTitle action={<button className="text-xs text-ink-400" onClick={() => (setParsed(null), setMapping(null))}>Choose another file</button>}>
            1 · Map columns — {fileName}
          </SectionTitle>
          <Card className="space-y-3">
            {parsed.skippedPreamble > 0 && <p className="text-xs text-ink-400">Skipped {parsed.skippedPreamble} line(s) above the header row.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {col("date", "Date column")}
              <Field label="Date format">
                <select className="input text-sm" value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as DateFormat })} aria-label="Date format">
                  {DATE_FORMATS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </Field>
              {col("description", "Description / narration")}
              {col("reference", "Reference no. (helps dedupe)", true)}
            </div>
            <Field label="How are amounts shown?">
              <select className="input text-sm" value={mapping.amountMode} onChange={(e) => setMapping({ ...guessAmountCols(mapping, parsed), amountMode: e.target.value as ColumnMapping["amountMode"] })} aria-label="Amount layout">
                <option value="split">Separate debit (withdrawal) and credit (deposit) columns</option>
                <option value="signed">One amount column, with − for money out</option>
                <option value="type">One amount column + a Dr/Cr column</option>
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {mapping.amountMode === "split" && (
                <>
                  {col("debit", "Debit / withdrawal column")}
                  {col("credit", "Credit / deposit column")}
                </>
              )}
              {mapping.amountMode !== "split" && col("amount", "Amount column")}
              {mapping.amountMode === "type" && col("type", "Dr/Cr column")}
              {mapping.amountMode === "signed" && (
                <label className="flex items-center gap-2 self-end pb-3 text-sm text-ink-300">
                  <input type="checkbox" className="h-4 w-4 accent-lime" checked={!!mapping.positiveIsDebit} onChange={(e) => setMapping({ ...mapping, positiveIsDebit: e.target.checked })} />
                  Positive numbers are money out (card statements)
                </label>
              )}
            </div>
          </Card>

          <SectionTitle>2 · Preview & check</SectionTitle>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(["all", "valid", "duplicate", "invalid"] as const).map((s) => (
              <button key={s} className={cx("chip", show === s && "chip-on")} onClick={() => setShow(s)}>
                {s === "all" ? `All ${summary.total}` : s === "valid" ? `✓ Will import ${summary.valid}` : s === "duplicate" ? `Duplicates ${summary.duplicate}` : `⚠ Invalid ${summary.invalid}`}
              </button>
            ))}
          </div>
          {summary.invalid > 0 && <p className="mb-2 text-xs text-amber">Invalid rows won't be imported. Fix the mapping above, or correct the file and re-upload.</p>}
          {summary.possibleInFileDuplicates > 0 && <p className="mb-2 text-xs text-ink-400">{summary.possibleInFileDuplicates} row(s) look identical to another row in this file without a bank reference. They're kept (two identical chai purchases are real) — untick any that aren't.</p>}
          <Card className="max-h-[50dvh] overflow-auto p-0" data-testid="csv-preview">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-ink-850 text-[11px] uppercase tracking-wider text-ink-400">
                <tr>
                  <th className="p-2 pl-3">Use</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Description</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.rowNumber} className={cx("border-t border-white/5 align-top", r.status === "invalid" && "bg-coral/[0.05]")}>
                    <td className="p-2 pl-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-lime"
                        disabled={r.status === "invalid"}
                        checked={r.status === "valid"}
                        onChange={(e) => setOverrides({ ...overrides, [r.rowNumber]: e.target.checked })}
                        aria-label={`Import row ${r.rowNumber}`}
                      />
                    </td>
                    <td className="num whitespace-nowrap p-2 text-xs">{r.date ? formatDay(r.date, { year: true }) : <span className="text-coral">{r.raw[mapping.date] || "—"}</span>}</td>
                    <td className="max-w-[220px] p-2">
                      <div className="truncate font-medium"><span data-preserve-case>{r.merchant}</span></div>
                      <div className="truncate text-xs text-ink-400">{r.description}</div>
                    </td>
                    <td className={cx("num whitespace-nowrap p-2 text-right", r.direction === "in" && "text-lime")}>{r.amountPaise !== undefined ? `${r.direction === "in" ? "+" : "−"}${formatINR(r.amountPaise)}` : "—"}</td>
                    <td className="p-2 text-xs">
                      {r.status === "invalid" ? (
                        <span className="text-coral">{r.errors.join("; ")}</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <span className="flex flex-wrap gap-1">
                            <Pill tone={r.kind === "expense" ? "default" : r.kind === "transfer" ? "default" : r.kind === "investment" ? "violet" : "lime"}>{r.kind}</Pill>
                            <Pill>{r.category}</Pill>
                          </span>
                          {r.duplicateReason && <span className="text-amber">{r.duplicateReason}</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="sticky bottom-24 mt-4 md:bottom-4">
            <button className="btn-primary h-14 w-full text-base shadow-2xl" disabled={busy || summary.valid === 0} onClick={doImport} data-testid="csv-import">
              {busy ? "Importing…" : `Import ${summary.valid} transaction${summary.valid === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {!parsed && (
        <>
          <SectionTitle>Tips</SectionTitle>
          <Card className="space-y-2 text-sm text-ink-300">
            <p>• Download the statement from net banking as CSV (or open the Excel export and “Save as CSV”).</p>
            <p>• Re-importing an overlapping date range is safe — matching rows are detected as duplicates.</p>
            <p>• Refunds are auto-linked to the original expense when there's one clear match; otherwise they're flagged for review.</p>
            <p>• Own-account transfers and salary are detected by your rules (Settings → Rules) and kept out of spending.</p>
            <p>• We never ask for bank passwords, PINs or OTPs.</p>
          </Card>
          {data && data.imports.length > 0 && (
            <>
              <SectionTitle>Past imports</SectionTitle>
              <Card className="space-y-2 text-sm">
                {data.imports.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {b.fileName} <span className="text-xs text-ink-400">· {new Date(b.importedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })} · {b.importedCount} added</span>
                    </span>
                    <button className="text-xs text-coral" onClick={() => db && undoImport(db, b.id)}>
                      Undo
                    </button>
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function guessAmountCols(m: ColumnMapping, p: ParsedCsv): ColumnMapping {
  const g = guessMapping(p.headers, p.rows);
  return { ...m, amount: m.amount ?? g.amount ?? 0, debit: m.debit ?? g.debit ?? 0, credit: m.credit ?? g.credit ?? 0, type: m.type ?? g.type ?? 0 };
}
