/**
 * The admin editor: one self-contained page. Its script runs only with the
 * per-request CSP nonce; no inline handlers, no external scripts.
 *
 * Model: "live" is the published config; "draft" holds saved, unpublished
 * changes (kept on the server, so they survive reloads). Each section's Save
 * writes that section into the draft; Reset discards the draft; Publish makes
 * the draft live as the next version. History lists every version with what
 * changed, and can revert to any of them.
 */
export function adminPage(meta: unknown, nonce: string): string {
  const data = JSON.stringify(meta).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>drip config</title>
<style>
:root{--bg:#07070a;--panel:#0d0d12;--card:#13131a;--line:#262631;--text:#e8e8ef;--muted:#8b8b9e;--lime:#c6ff3d;--amber:#ffc24b;--coral:#ff6b6b}
*{box-sizing:border-box}html,body{margin:0;height:100%}body{background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 20px;background:var(--panel);border-bottom:1px solid var(--line)}
header h1{font-size:18px;margin:0}.pill{font-size:12px;padding:3px 10px;border-radius:999px;background:#1a1a23;color:var(--muted)}.pill.live{color:var(--lime)}.pill.draft{color:var(--amber)}
.grow{flex:1}.layout{display:grid;grid-template-columns:230px 1fr;min-height:calc(100% - 60px)}
nav{border-right:1px solid var(--line);padding:12px 8px;background:var(--panel)}nav button{display:flex;width:100%;justify-content:space-between;align-items:center;gap:6px;text-align:left;background:none;border:0;color:var(--text);padding:9px 12px;border-radius:10px;font:inherit;cursor:pointer}
nav button:hover{background:#1a1a23}nav button.on{background:#1f2410;color:var(--lime)}nav .dot{font-size:11px;color:var(--amber)}nav hr{border:0;border-top:1px solid var(--line);margin:8px 4px}
main{padding:20px 28px 60px;max-width:1000px}h2{margin:0 0 4px;font-size:20px}.sub{color:var(--muted);font-size:13px;margin:0 0 16px}
input,select,textarea{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:inherit;width:100%}textarea{min-height:120px;font-family:ui-monospace,monospace;font-size:13px}
label{font-size:13px;color:var(--muted)}table{width:100%;border-collapse:collapse}td,th{padding:5px 4px;text-align:left;font-size:13px;vertical-align:middle;border-bottom:1px solid #1a1a23}th{color:var(--muted);font-weight:500}
button{background:#1a1a23;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 14px;font:inherit;cursor:pointer}button:disabled{opacity:.4;cursor:default}
button.primary{background:var(--lime);color:#07070a;border:0;font-weight:700}button.danger{color:var(--coral);border-color:#4a2626}button.x{padding:3px 9px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
.foot{display:flex;gap:10px;align-items:center;margin-top:18px;padding-top:14px;border-top:1px solid var(--line)}.chk{width:auto}
.msg{font-size:13px;white-space:pre-wrap}.msg.err{color:var(--coral)}.msg.ok{color:var(--lime)}.changes{margin:6px 0 0;padding-left:18px;color:var(--muted);font-size:13px}
.badge{font-size:11px;padding:2px 8px;border-radius:999px;background:#1f2410;color:var(--lime);margin-left:6px;font-weight:500}.muted{color:var(--muted)}
pre{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;overflow:auto;max-height:420px;font-size:12px}
@media(max-width:760px){.layout{grid-template-columns:1fr}nav{display:flex;overflow:auto;border-right:0;border-bottom:1px solid var(--line)}nav button{white-space:nowrap;width:auto}nav hr{display:none}main{padding:16px}}
</style></head><body>
<header><h1>drip config</h1><span class="pill live" id="livePill">live: …</span><span class="pill draft" id="draftPill" hidden></span><span class="grow"></span>
<span class="msg" id="msg"></span>
<button class="danger" data-action="reset" id="resetBtn" disabled>Reset</button>
<input id="note" placeholder="Note for this version" style="width:220px"><button class="primary" data-action="publish" id="publishBtn" disabled>Publish</button></header>
<div class="layout"><nav id="nav"></nav><main id="main"></main></div>
<script nonce="${nonce}">
"use strict";
const META = ${data};
const HELP = {
  tabs: "Five navigation actions: Today, Manual log, Activity, Stats and Settings. Brief is merged into Today; legacy Brief settings remain compatible.",
  screens: "Page title and subtitle per screen. Empty keeps the app's own text; Today's title replaces the greeting.",
  rules: "If the merchant or SMS contains the text, it gets this category. Personal rules always win. History is opt-in per rule, limited to 12 months and never touches user edits.",
  merchants: "Text contains → the name shown in the app. Use whole word for short names so “ola” doesn't match “coca cola”.",
  smsParsing: "Where the app finds the merchant name in a bank SMS. Changes apply to new SMS; use Re-read to apply them to past payments.",
  banks: "Which SMS senders are banks: the sender ID between the dashes (VM-YESBNK-S). End with * for any letters after (SBI*) or ? for one optional letter (ICICI?). Only these senders' SMS are read.",
  smsIgnore: "One phrase per line. Bank SMS containing any of them are never read as transactions.",
  budget: "Numbers the app uses for salaries, the night brief and weekly insights.",
  features: "Switch a feature off for everyone. Turning app lock off only hides its switch for people who haven't enabled it.",
  announcement: "A banner on Today. Change the id to show it again to people who dismissed it. Links must start " + META.allowedLinks[0],
  update: "Shown to apps older than this version. The link must start " + META.allowedLinks[0],
};
let live = null, saved = null, history = [], section = "tabs", dirty = false;
const $ = (id) => document.getElementById(id);
const clone = (x) => JSON.parse(JSON.stringify(x));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const opt = (list, v) => list.map((x) => "<option" + (x === v ? " selected" : "") + ">" + esc(x) + "</option>").join("");
const KINDS = ["", "expense", "investment", "transfer", "income", "refund", "settlement"];
const working = () => saved || live;
const sectionDiffers = (a, b, s) => META.sectionFields[s].some((f) => JSON.stringify(a[f] ?? null) !== JSON.stringify(b[f] ?? null));
function msg(t, ok) { $("msg").className = "msg " + (ok ? "ok" : "err"); $("msg").textContent = t || ""; }
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({ ok: false, errors: ["Unexpected response (" + r.status + ")"] }));
}

async function load() {
  const d = await api("GET", "/admin/api/state");
  live = d.published; saved = d.draft; history = d.history;
  if (!d.canPublish) msg("Publishing is off: the backend's signing key isn't set.");
  renderChrome(); renderSection();
}
function changedSections() { return saved ? META.sections.filter((s) => sectionDiffers(saved, live, s)) : []; }
function renderChrome() {
  const changed = changedSections();
  $("livePill").textContent = "live: v" + live.version;
  $("draftPill").hidden = !changed.length;
  $("draftPill").textContent = changed.length + " unpublished section" + (changed.length === 1 ? "" : "s");
  $("resetBtn").disabled = !saved; $("publishBtn").disabled = !changed.length;
  const item = (s, label) => '<button data-nav="' + s + '" class="' + (section === s ? "on" : "") + '"><span>' + esc(label) + "</span>" + (changed.includes(s) ? '<span class="dot">● unpublished</span>' : "") + "</button>";
  $("nav").innerHTML = META.sections.map((s) => item(s, META.sectionLabels[s])).join("") + "<hr>" + item("usage", "Analytics") + item("raw", "Raw JSON") + item("history", "Version history");
}
function go(s) {
  if (dirty && !confirm("You have unsaved edits on this page. Discard them?")) return;
  section = s; dirty = false; msg(""); renderChrome(); renderSection();
}

// ---------------------------------------------------------------- sections
const VIEWS = {
  tabs: (c) => '<label>Highlighted primary action</label><select id="primaryAction">' + c.tabs.filter((t) => t.visible && t.id !== "briefing").map((t) => '<option value="' + esc(t.id) + '"' + (t.id === (c.primaryAction === "briefing" ? "today" : c.primaryAction || "today") ? ' selected' : '') + '>' + esc(t.label) + '</option>').join('') + '</select><p class="sub">The primary action is raised and highlighted; the current page changes colour.</p><table id="tabsTable"><tbody><tr><th>#</th><th>Name</th><th>Show</th><th>Tab</th><th></th></tr>' + c.tabs.map((t, i) => t.id === "briefing" ? "" : "<tr><td>" + (i + 1) + '</td><td><input data-tab="' + i + '" value="' + esc(t.label) + '" maxlength="16"></td><td><input type="checkbox" class="chk" data-vis="' + i + '"' + (t.visible ? " checked" : "") + (t.id === "today" ? " disabled" : "") + '></td><td class="muted">' + esc(t.id) + '</td><td><button class="x" data-action="move" data-d="-1">↑</button> <button class="x" data-action="move" data-d="1">↓</button></td></tr>').join("") + "</tbody></table>",
  screens: (c) => "<table><tbody><tr><th>Screen</th><th>Title</th><th>Subtitle</th></tr>" + META.screenIds.filter((s) => s !== "briefing").map((s) => { const v = c.screens[s] || {}; return "<tr><td>" + esc(s) + '</td><td><input data-st="' + esc(s) + '" value="' + esc(v.title) + '" maxlength="40"></td><td><input data-ss="' + esc(s) + '" value="' + esc(v.subtitle) + '" maxlength="120"></td></tr>'; }).join("") + "</tbody></table>",
  rules: (c) => '<p><label><input type="checkbox" class="chk" id="replaceRules"' + (c.replaceBuiltInRules ? " checked" : "") + "> Use only these rules (the app's built-in list is then just the offline fallback)</label></p>" + '<input id="filter" placeholder="Filter rules…" style="margin-bottom:8px"><table id="rules"><tbody><tr><th>Contains</th><th>Category</th><th>Tag</th><th>Kind</th><th>Money</th><th>Priority</th><th>Apply to past 12 months</th><th>History revision</th><th></th></tr>' + c.rules.map(ruleRow).join("") + '</tbody></table><button data-action="add" data-list="rules">+ Rule</button><p class="sub" style="margin-top:14px">Switch off built-in rules, one pattern per line (only matters when the list above isn\\'t replacing them):</p><textarea id="disabledRules">' + esc(c.disabledRules.join("\\n")) + "</textarea>",
  merchants: (c) => '<p><label><input type="checkbox" class="chk" id="replaceMerchants"' + (c.replaceBuiltInMerchants ? " checked" : "") + "> Use only these names (the app's built-in list is then just the offline fallback)</label></p>" + '<input id="filter" placeholder="Filter names…" style="margin-bottom:8px"><table id="merchants"><tbody><tr><th>Contains</th><th>Name</th><th>Whole word</th><th></th></tr>' + c.merchants.map((m) => merchantRow(m)).join("") + '</tbody></table><button data-action="add" data-list="merchants">+ Name</button>',
  smsParsing: (c) => '<label>Merchant name starts after</label><table id="merchantAfter"><tbody><tr><th>Text</th><th>Money</th><th></th></tr>' + c.merchantAfter.map(afterRow).join("") + '</tbody></table><button data-action="add" data-list="merchantAfter">+ Text</button><p></p><label>Merchant name ends at (one per line)</label><textarea id="merchantStops" style="min-height:80px">' + esc(c.merchantStops.join("\\n")) + "</textarea>" + rereadCard(c.smsReread),
  banks: (c) => '<p><label><input type="checkbox" class="chk" id="replaceBanks"' + (c.replaceBuiltInBanks ? " checked" : "") + "> Use only these banks (the app's built-in list is then just the offline fallback)</label></p>" + '<table id="banks"><tbody><tr><th>Sender ID</th><th>Bank name</th><th></th></tr>' + c.banks.map((b) => bankRow(b)).join("") + '</tbody></table><button data-action="add" data-list="banks">+ Bank</button>',
  smsIgnore: (c) => '<textarea id="smsIgnore">' + esc(c.smsIgnore.join("\\n")) + "</textarea>",
  budget: (c) => { const B = { lateSalaryDay: "Salary counts for next month from day", bigCreditRupees: "…if it's at least (₹)", insightMinRupees: "Insight: minimum change (₹)", insightRisePct: "Insight: minimum rise (%)" }; return '<label>Budget modes offered</label><select id="setAsideModes"><option value="both"' + ((c.budget.setAsideModes || []).length !== 1 ? " selected" : "") + '>Planned and Actual</option><option value="planned"' + (c.budget.setAsideModes?.length === 1 && c.budget.setAsideModes[0] === "planned" ? " selected" : "") + '>Planned only</option><option value="actual"' + (c.budget.setAsideModes?.length === 1 && c.budget.setAsideModes[0] === "actual" ? " selected" : "") + '>Actual only</option></select><p class="sub">Changes the budget editor and onboarding choices. Existing saved budgets keep their mode.</p><div class="grid">' + Object.keys(B).map((k) => "<div><label>" + B[k] + '</label><input type="number" data-b="' + k + '" value="' + Number(c.budget[k]) + '"></div>').join("") + "</div>"; },
  features: (c) => '<div class="grid">' + Object.keys(c.features).map((k) => '<label class="card" style="margin:0"><input type="checkbox" class="chk" data-f="' + esc(k) + '"' + (c.features[k] ? " checked" : "") + "> " + esc(k) + "</label>").join("") + "</div>",
  announcement: (c) => { const a = c.announcement || {}; return '<p><label><input type="checkbox" class="chk" id="a_on"' + (c.announcement ? " checked" : "") + '> Show a banner</label></p><div class="grid"><div><label>Id</label><input id="a_id" value="' + esc(a.id) + '"></div><div><label>Tone</label><select id="a_tone">' + opt(["info", "warn"], a.tone || "info") + '</select></div></div><label>Text</label><input id="a_text" maxlength="200" value="' + esc(a.text) + '"><label>Link (optional)</label><input id="a_link" value="' + esc(a.link) + '">'; },
  update: (c) => { const u = c.update || {}; return '<p><label><input type="checkbox" class="chk" id="u_on"' + (c.update ? " checked" : "") + '> Show a new version notice</label></p><div class="grid"><div><label>Latest version</label><input id="u_version" placeholder="0.8.0" value="' + esc(u.latestVersion) + '"></div><div><label>Download link</label><input id="u_url" value="' + esc(u.url) + '"></div></div><label>Message (optional)</label><input id="u_msg" maxlength="160" value="' + esc(u.message) + '">'; },
};
function ruleRow(r) {
  const tags = META.tags[r.category] || [];
  return '<tr data-row="rules"><td><input data-k="contains" value="' + esc(r.contains) + '"></td><td><select data-k="category">' + opt([...new Set([...META.categories, r.category])], r.category) + '</select></td><td><input data-k="tag" value="' + esc(r.tag) + '" placeholder="' + esc(tags.slice(0, 2).join(", ")) + '"></td><td><select data-k="kind">' + opt(KINDS, r.kind || "") + '</select></td><td><select data-k="direction">' + opt(["", "in", "out"], r.direction || "") + '</select></td><td><input type="number" data-k="priority" value="' + Number(r.priority ?? 5) + '" style="width:64px"></td><td><input type="checkbox" class="chk" data-k="applyToHistory"' + (r.applyToHistory ? ' checked' : '') + '></td><td><input type="number" min="0" data-k="historyRevision" value="' + Number(r.historyRevision ?? 0) + '" style="width:64px"></td><td><button class="x" data-action="remove">✕</button></td></tr>';
}
function merchantRow(m) { return '<tr data-row="merchants"><td><input data-a value="' + esc(m.contains) + '"></td><td><input data-b value="' + esc(m.name) + '"></td><td><input type="checkbox" class="chk" data-w' + (m.word ? " checked" : "") + '></td><td><button class="x" data-action="remove">✕</button></td></tr>'; }
function rereadCard(r) {
  const v = r || { run: 0, months: 1, names: true, categories: false, only: "unnamed" };
  return '<div class="card" style="margin-top:18px"><h3 style="margin:0 0 4px;font-size:16px">Re-read stored SMS</h3><p class="sub">Off unless switched on. Uses the SMS text already saved on phones, never the inbox. Runs once per run number; transactions people edited are never changed.</p>'
    + '<p><label><input type="checkbox" class="chk" id="rr_on"' + (r ? " checked" : "") + '> Re-read on every phone</label></p><div class="grid">'
    + '<div><label>Run number (raise to run again)</label><input type="number" min="1" id="rr_run" value="' + Number(r ? v.run : 1) + '"></div>'
    + '<div><label>Period</label><select id="rr_months">' + [1, 2, 3, 6, 12].map((m) => '<option value="' + m + '"' + (v.months === m ? " selected" : "") + ">Last " + m + " month" + (m === 1 ? "" : "s") + "</option>").join("") + "</select></div>"
    + '<div><label>Which payments</label><select id="rr_only"><option value="unnamed"' + (v.only === "unnamed" ? " selected" : "") + '>Only where no merchant was found</option><option value="all"' + (v.only === "all" ? " selected" : "") + ">All automatic payments</option></select></div>"
    + '<div><label>Only SMS containing (optional)</label><input id="rr_contains" value="' + esc(v.contains) + '"></div></div>'
    + '<p><label><input type="checkbox" class="chk" id="rr_names"' + (v.names ? " checked" : "") + '> Update merchant names</label> &nbsp; <label><input type="checkbox" class="chk" id="rr_categories"' + (v.categories ? " checked" : "") + "> Update categories with current rules</label></p></div>";
}
function afterRow(a) { return '<tr data-row="merchantAfter"><td><input data-a value="' + esc(a.text) + '"></td><td><select data-d>' + [["", "both"], ["out", "money out"], ["in", "money in"]].map(([v, l]) => '<option value="' + v + '"' + ((a.direction || "") === v ? " selected" : "") + ">" + l + "</option>").join("") + '</select></td><td><button class="x" data-action="remove">✕</button></td></tr>'; }
function bankRow(b) { return '<tr data-row="banks"><td><input data-a value="' + esc(b.sender) + '"></td><td><input data-b value="' + esc(b.bank) + '"></td><td><button class="x" data-action="remove">✕</button></td></tr>'; }
const lines = (id) => $(id).value.split("\\n").map((s) => s.trim()).filter(Boolean);
const rows = (list) => [...document.querySelectorAll('[data-row="' + list + '"]')];
const COLLECT = {
  tabs: (c) => { c.primaryAction = $("primaryAction").value; c.tabs = [...document.querySelectorAll("[data-tab]")].map((el) => { const i = Number(el.dataset.tab); return { ...c.tabs[i], label: el.value.trim(), visible: c.tabs[i].id === "today" || document.querySelector('[data-vis="' + i + '"]').checked }; }); },
  screens: (c) => { c.screens = c.screens.briefing ? { briefing: c.screens.briefing } : {}; META.screenIds.filter((s) => s !== "briefing").forEach((s) => { const t = document.querySelector('[data-st="' + s + '"]').value.trim(), st = document.querySelector('[data-ss="' + s + '"]').value.trim(); if (t || st) c.screens[s] = { title: t || undefined, subtitle: st || undefined }; }); },
  rules: (c) => { c.rules = rows("rules").map((tr) => { const g = (k) => tr.querySelector('[data-k="' + k + '"]').value.trim(); return { contains: g("contains"), category: g("category"), tag: g("tag") || undefined, kind: g("kind") || undefined, direction: g("direction") || undefined, priority: Number(g("priority")), applyToHistory: tr.querySelector('[data-k="applyToHistory"]').checked || undefined, historyRevision: Number(g("historyRevision")) }; }); c.replaceBuiltInRules = $("replaceRules").checked; c.disabledRules = lines("disabledRules"); },
  merchants: (c) => { c.merchants = rows("merchants").map((tr) => ({ contains: tr.querySelector("[data-a]").value.trim(), name: tr.querySelector("[data-b]").value.trim(), word: tr.querySelector("[data-w]").checked || undefined })); c.replaceBuiltInMerchants = $("replaceMerchants").checked; },
  smsParsing: (c) => { c.merchantAfter = rows("merchantAfter").map((tr) => ({ text: tr.querySelector("[data-a]").value, direction: tr.querySelector("[data-d]").value || undefined })).filter((a) => a.text.trim()); c.merchantStops = lines("merchantStops"); c.smsReread = $("rr_on").checked ? { run: Number($("rr_run").value), months: Number($("rr_months").value), names: $("rr_names").checked, categories: $("rr_categories").checked, only: $("rr_only").value, contains: $("rr_contains").value.trim() || undefined } : null; },
  banks: (c) => { c.banks = rows("banks").map((tr) => ({ sender: tr.querySelector("[data-a]").value.trim(), bank: tr.querySelector("[data-b]").value.trim() })); c.replaceBuiltInBanks = $("replaceBanks").checked; },
  smsIgnore: (c) => { c.smsIgnore = lines("smsIgnore"); },
  budget: (c) => { const mode = document.getElementById("setAsideModes").value; c.budget.setAsideModes = mode === "both" ? ["planned", "actual"] : [mode]; document.querySelectorAll("[data-b]").forEach((el) => (c.budget[el.dataset.b] = Number(el.value))); },
  features: (c) => { document.querySelectorAll("[data-f]").forEach((el) => (c.features[el.dataset.f] = el.checked)); },
  announcement: (c) => { c.announcement = $("a_on").checked ? { id: $("a_id").value.trim() || "a" + Date.now(), text: $("a_text").value.trim(), link: $("a_link").value.trim() || undefined, tone: $("a_tone").value } : null; },
  update: (c) => { c.update = $("u_on").checked ? { latestVersion: $("u_version").value.trim(), url: $("u_url").value.trim(), message: $("u_msg").value.trim() || undefined } : null; },
};

function renderSection() {
  const w = working();
  if (section === "history") return renderHistory();
  if (section === "usage") return renderUsage();
  if (section === "raw") {
    $("main").innerHTML = '<h2>Raw JSON</h2><p class="sub">The whole working config, saved changes included. Edit and save to replace the draft in one go.</p><textarea id="raw" style="min-height:460px">' + esc(JSON.stringify(w, null, 2)) + '</textarea><div class="foot"><button class="primary" data-action="save">Save</button><button data-action="discard">Discard edits</button><span class="muted" id="dirty"></span></div>';
    return;
  }
  const changed = changedSections().includes(section);
  $("main").innerHTML = "<h2>" + esc(META.sectionLabels[section]) + (changed ? '<span class="badge">saved, not published</span>' : "") + '</h2><p class="sub">' + esc(HELP[section]) + "</p>" + VIEWS[section](w) + '<div class="foot"><button class="primary" data-action="save">Save</button><button data-action="discard">Discard edits</button><span class="muted" id="dirty"></span></div>';
}

async function save() {
  let next;
  if (section === "raw") { try { next = JSON.parse($("raw").value); } catch (e) { return msg("That isn't valid JSON: " + e.message); } }
  else { next = clone(working()); COLLECT[section](next); }
  const d = await api("PUT", "/admin/api/draft", { config: next });
  if (!d.ok) return msg("Not saved:\\n" + (d.errors || []).join("\\n"));
  saved = d.draft; dirty = false; msg("Saved. Publish when you're ready.", true); renderChrome(); renderSection();
}
async function reset() {
  if (!confirm("Discard all saved changes that aren't published?")) return;
  const d = await api("DELETE", "/admin/api/draft");
  if (!d.ok) return msg((d.errors || ["Couldn't reset"]).join("\\n"));
  saved = null; dirty = false; msg("Unpublished changes discarded.", true); renderChrome(); renderSection();
}
async function publish() {
  if (dirty && !confirm("This page has unsaved edits, which won't be published. Continue?")) return;
  if (!confirm("Publish " + changedSections().length + " changed section(s) to every app?")) return;
  const d = await api("POST", "/admin/api/publish", { note: $("note").value });
  if (!d.ok) return msg("Not published:\\n" + (d.errors || []).join("\\n"));
  $("note").value = ""; dirty = false; msg("Published v" + d.version + ". Apps pick it up next time they open.", true); load();
}

// ---------------------------------------------------------------- analytics
let usageDays = 7, usageTimer = null;
const sum = (rows, ev, f) => rows.filter((r) => r.event === ev && (!f || f(r))).reduce((a, r) => a + r.n, 0);
const fmtDur = (sec) => sec >= 3600 ? (sec / 3600).toFixed(1) + " h" : sec >= 60 ? Math.round(sec / 60) + " min" : Math.round(sec) + " s";
function bars(points, fmt) {
  const W = 640, H = 120, max = Math.max(1, ...points.map((p) => p.v)), w = W / Math.max(1, points.length);
  return '<svg viewBox="0 0 ' + W + " " + (H + 18) + '" style="width:100%;height:auto">' + points.map((p, i) => { const h = Math.round((p.v / max) * H); return '<rect x="' + (i * w + 1) + '" y="' + (H - h) + '" width="' + Math.max(1, w - 2) + '" height="' + Math.max(h, p.v ? 1 : 0) + '" rx="2" fill="#c6ff3d"><title>' + esc(p.label + ": " + fmt(p.v)) + "</title></rect>"; }).join("")
    + '<text x="0" y="' + (H + 14) + '" fill="#8b8b9e" font-size="11">' + esc(points[0] ? points[0].label : "") + '</text><text x="' + W + '" y="' + (H + 14) + '" fill="#8b8b9e" font-size="11" text-anchor="end">' + esc(points.length ? points[points.length - 1].label : "") + "</text></svg>";
}
function tile(label, value, hint) { return '<div class="card" style="margin:0"><div class="muted" style="font-size:12px">' + esc(label) + '</div><div style="font-size:24px;font-weight:700">' + esc(value) + "</div>" + (hint ? '<div class="muted" style="font-size:12px">' + esc(hint) + "</div>" : "") + "</div>"; }
function breakdown(title, rows, ev, base) {
  const by = {};
  rows.filter((r) => r.event === ev).forEach((r) => (by[r.dim] = (by[r.dim] || 0) + r.n));
  const list = Object.entries(by).sort((a, b) => b[1] - a[1]);
  return '<div class="card"><b>' + esc(title) + "</b><table>" + (list.length ? list.map(([k, n]) => "<tr><td>" + esc(k || "–") + '</td><td style="text-align:right">' + n + (base ? ' <span class="muted">(' + Math.round((n / base) * 100) + "%)</span>" : "") + "</td></tr>").join("") : '<tr><td class="muted">No data yet</td></tr>') + "</table></div>";
}
async function renderUsage() {
  clearInterval(usageTimer);
  $("main").innerHTML = '<h2>Analytics</h2><p class="sub">Anonymous, aggregate counts only: no IDs, IPs or personal data are stored. People can switch it off in Settings; Features → analytics switches it off for everyone.</p><div id="usage" class="muted">Loading…</div>';
  const d = await api("GET", "/admin/api/usage?days=" + usageDays);
  if (section !== "usage") return;
  if (d.errors) return ($("usage").innerHTML = '<p class="msg err">' + esc(d.errors.join(" ")) + "</p>");
  const rows = d.rows, buckets = [...new Set(rows.map((r) => r.day))].sort();
  const series = (ev, f) => buckets.map((b) => ({ label: usageDays <= 1 ? b.slice(11) + ":00" : b.slice(5), v: f ? f(rows.filter((r) => r.day === b)) : sum(rows.filter((r) => r.day === b), ev) }));
  const sessions = sum(rows, "session"), seconds = rows.filter((r) => r.event === "session").reduce((a, r) => a + r.total, 0);
  const lastDay = buckets.length ? buckets[buckets.length - 1] : null;
  const dau = usageDays <= 1 ? sum(rows, "active_day") : lastDay ? sum(rows.filter((r) => r.day === lastDay), "active_day") : 0;
  const activeDays = sum(rows, "active_day");
  const live = {}; d.live.forEach((m) => (live[m.minute] = m.n));
  const liveSeries = Array.from({ length: 60 }, (_, i) => { const m = d.now - 59 + i; return { label: new Date(m * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), v: live[m] || 0 }; });
  const dl = d.downloads.reduce((a, r) => a + r.count, 0);
  const range = [[1, "24 hours"], [7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"]].map(([n, l]) => '<button data-action="usage-range" data-days="' + n + '"' + (n === usageDays ? ' class="primary"' : "") + ">" + l + "</button>").join(" ");
  $("usage").innerHTML = '<p>' + range + '</p>'
    + '<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>Real time</b><span class="muted" style="font-size:12px">refreshes every 15 s</span></div><div style="font-size:28px;font-weight:700">' + (live[d.now - 1] || live[d.now] || 0) + ' <span class="muted" style="font-size:14px;font-weight:400">active in the last minute</span></div>' + bars(liveSeries, (v) => v + " active") + "</div>"
    + '<div class="grid">' + tile("Installs", sum(rows, "install"), "all time " + (d.allTime.install || 0)) + tile(usageDays <= 1 ? "Users today" : "Users on " + (lastDay || "–"), dau) + tile("Users this week", d.weekUsers) + tile("Users this month", d.monthUsers)
    + tile("Sessions", sessions) + tile("Avg. session", sessions ? fmtDur(seconds / sessions) : "–") + tile("Time spent", fmtDur(seconds)) + tile("Config downloads", sum(rows, "config"), "all time " + (d.allTime.config || 0)) + tile("GitHub downloads", dl, d.downloads.length + " releases") + "</div>"
    + '<div class="card"><b>Daily users</b>' + bars(series("active_day"), (v) => v + " users") + '</div><div class="card"><b>Installs</b>' + bars(series("install"), (v) => v + " installs") + '</div><div class="card"><b>Sessions</b>' + bars(series("session"), (v) => v + " sessions")
    + '</div><div class="card"><b>Average session</b>' + bars(series(null, (rs) => { const s = rs.filter((r) => r.event === "session"); const n = s.reduce((a, r) => a + r.n, 0); return n ? s.reduce((a, r) => a + r.total, 0) / n : 0; }), fmtDur) + '</div><div class="card"><b>Traffic: config downloads</b>' + bars(series("config"), (v) => v + " requests") + "</div>"
    + '<div class="grid">' + breakdown("Screens", rows, "screen") + breakdown("App versions (daily users)", rows, "active_day") + breakdown("Features (share of daily users)", rows, "feature", activeDays) + breakdown("Platforms (installs)", rows, "install") + "</div>"
    + '<div class="card"><b>GitHub release downloads</b><table>' + d.downloads.map((r) => "<tr><td>" + esc(r.tag) + '</td><td class="muted">' + esc(new Date(r.at).toLocaleDateString()) + '</td><td style="text-align:right">' + r.count + "</td></tr>").join("") + '</table><p class="sub">Google Play installs appear under Installs once the Play build is live; Play Console has store-side numbers.</p></div>';
  usageTimer = setInterval(() => { if (section === "usage" && !document.hidden) renderUsage(); else clearInterval(usageTimer); }, 15000);
}

// ---------------------------------------------------------------- history
function renderHistory() {
  const card = (h) => '<div class="card"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>v' + Number(h.version) + "</b>" + (h.version === live.version ? '<span class="badge">live</span>' : "") + '<span class="muted">' + esc(new Date(h.publishedAt).toLocaleString()) + '</span><span class="grow"></span><button data-action="view" data-v="' + Number(h.version) + '">View</button>' + (h.version === live.version ? "" : '<button data-action="revert" data-v="' + Number(h.version) + '">Revert to this</button>') + "</div>" + (h.note ? "<div>" + esc(h.note) + "</div>" : "") + (h.revertOf ? '<div class="muted">Revert to v' + Number(h.revertOf) + "</div>" : "") + '<ul class="changes">' + (h.changes && h.changes.length ? h.changes.map((c) => "<li>" + esc(c) + "</li>").join("") : "<li>No setting changes recorded</li>") + '</ul><div id="view-' + Number(h.version) + '"></div></div>';
  $("main").innerHTML = '<h2>Version history</h2><p class="sub">Every published version, newest first, with what changed. Reverting publishes that version again as a new version.</p>' + (history.length ? history.map(card).join("") : '<p class="muted">Nothing published yet.</p>');
}
async function view(v) {
  const box = $("view-" + v);
  if (box.innerHTML) return (box.innerHTML = "");
  const d = await api("GET", "/admin/api/version/" + Number(v));
  box.innerHTML = d.config ? "<pre>" + esc(JSON.stringify(d.config, null, 2)) + "</pre>" : '<p class="msg err">Not found</p>';
}
async function revert(v) {
  if (!confirm("Publish v" + v + " again as the newest version? Unpublished saved changes will be discarded.")) return;
  const d = await api("POST", "/admin/api/revert", { version: Number(v), note: $("note").value || "Reverted to v" + v });
  if (!d.ok) return msg("Not reverted:\\n" + (d.errors || []).join("\\n"));
  $("note").value = ""; msg("Reverted: v" + d.version + " is live (same settings as v" + v + ").", true); load();
}

// ---------------------------------------------------------------- events
function markDirty() { dirty = true; const d = $("dirty"); if (d) d.textContent = "Unsaved edits"; }
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]"); if (nav) return go(nav.dataset.nav);
  const b = e.target.closest("[data-action]"); if (!b) return;
  const a = b.dataset.action;
  if (a === "save") return save();
  if (a === "discard") { dirty = false; msg(""); return renderSection(); }
  if (a === "reset") return reset();
  if (a === "publish") return publish();
  if (a === "view") return view(b.dataset.v);
  if (a === "usage-range") { usageDays = Number(b.dataset.days); return renderUsage(); }
  if (a === "revert") return revert(b.dataset.v);
  if (a === "remove") { b.closest("tr").remove(); return markDirty(); }
  if (a === "move") {
    const tr = b.closest("tr"), up = b.dataset.d === "-1";
    const sib = up ? tr.previousElementSibling : tr.nextElementSibling;
    if (sib && sib.querySelector("[data-tab]")) { up ? tr.parentNode.insertBefore(tr, sib) : tr.parentNode.insertBefore(sib, tr); }
    [...document.querySelectorAll("[data-tab]")].forEach((el, i) => (el.closest("tr").firstElementChild.textContent = i + 1));
    return markDirty();
  }
  if (a === "add") {
    const list = b.dataset.list, body = $(list).querySelector("tbody");
    body.insertAdjacentHTML("beforeend", list === "rules" ? ruleRow({ contains: "", category: "Other", priority: 5 }) : list === "merchants" ? merchantRow({ contains: "", name: "" }) : list === "merchantAfter" ? afterRow({ text: "" }) : bankRow({ sender: "", bank: "" }));
    body.lastElementChild.querySelector("input").focus();
    return markDirty();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "note") return;
  if (e.target.id === "filter") { const q = e.target.value.toLowerCase(); document.querySelectorAll("[data-row]").forEach((tr) => (tr.style.display = [...tr.querySelectorAll("input,select")].some((i) => String(i.value).toLowerCase().includes(q)) ? "" : "none")); return; }
  if (e.target.closest("main")) markDirty();
});
document.addEventListener("change", (e) => { if (e.target.closest("main") && e.target.id !== "filter") markDirty(); });
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
load();
</script></body></html>`;
}
