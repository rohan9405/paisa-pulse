/** The admin editor: one self-contained page, no external scripts. */
export function adminPage(meta: unknown): string {
  const data = JSON.stringify(meta).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>drip admin</title>
<style>
:root{--bg:#07070a;--card:#13131a;--line:#262631;--text:#e8e8ef;--muted:#8b8b9e;--lime:#c6ff3d;--coral:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
main{max-width:920px;margin:auto;padding:20px 16px 120px}h1{margin:0 0 4px}h2{font-size:16px;margin:0 0 4px}
.sub{color:var(--muted);font-size:13px;margin:0 0 12px}section{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:14px 0}
input,select,textarea{background:#0d0d12;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:inherit;width:100%}
textarea{min-height:80px;font-family:ui-monospace,monospace;font-size:13px}label{font-size:13px;color:var(--muted)}
table{width:100%;border-collapse:collapse}td,th{padding:4px;text-align:left;font-size:13px;vertical-align:middle}th{color:var(--muted);font-weight:500}
button{background:#1a1a23;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 12px;font:inherit;cursor:pointer}
button.primary{background:var(--lime);color:#07070a;border:0;font-weight:700}button.x{padding:4px 9px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.row{display:flex;gap:8px;align-items:center}
.bar{position:fixed;inset:auto 0 0 0;background:#0d0d12ee;border-top:1px solid var(--line);padding:12px 16px}.bar .in{max-width:920px;margin:auto;display:flex;gap:10px;align-items:center}
.err{color:var(--coral);font-size:13px;white-space:pre-wrap}.ok{color:var(--lime);font-size:13px}.chk{width:auto}
</style></head><body><main>
<h1>drip admin</h1><p class="sub">Changes reach every app the next time it opens (or within a minute of coming back to the foreground). Settings only: never put anyone's transactions or personal data here.</p>

<section><h2>Bottom tabs</h2><p class="sub">Order, names and which to show. Today is always shown.</p><table id="tabs"></table></section>

<section><h2>Screen titles</h2><p class="sub">Leave empty to keep the app's own text. Today's title replaces the greeting.</p><table id="screens"></table></section>

<section><h2>Categorisation rules</h2><p class="sub">If the merchant or SMS contains the text, it gets this category. Built-ins are priority 0, a user's own rules 10.</p>
<table id="rules"><thead><tr><th>Contains</th><th>Category</th><th>Tag</th><th>Kind</th><th>Money</th><th>Priority</th><th></th></tr></thead><tbody></tbody></table>
<button onclick="addRule()">+ Rule</button>
<p class="sub" style="margin-top:12px">Switch off built-in rules (one pattern per line, e.g. <code>ola</code>):</p><textarea id="disabledRules"></textarea></section>

<section><h2>Merchant names</h2><p class="sub">Text contains → name shown in the app (e.g. "bundl" → Swiggy).</p>
<table id="merchants"><tbody></tbody></table><button onclick="addPair('merchants')">+ Name</button></section>

<section><h2>Bank SMS senders</h2><p class="sub">Add a bank by its SMS sender ID, the part between the dashes (VM-<b>YESBNK</b>-S).</p>
<table id="banks"><tbody></tbody></table><button onclick="addPair('banks')">+ Bank</button></section>

<section><h2>Ignore SMS containing</h2><p class="sub">One phrase per line. Matching bank SMS are never read as transactions.</p><textarea id="smsIgnore"></textarea></section>

<section><h2>Budget and insights</h2><div class="grid" id="budget"></div></section>

<section><h2>Features</h2><p class="sub">Switch a feature off for everyone (e.g. while fixing a bug).</p><div class="grid" id="features"></div></section>

<section><h2>Announcement</h2><p class="sub">A banner on Today. Change the id to show it again to people who dismissed it. Empty text = no banner.</p>
<div class="grid"><div><label>Id</label><input id="a_id"></div><div><label>Tone</label><select id="a_tone"><option>info</option><option>warn</option></select></div></div>
<label>Text</label><input id="a_text" maxlength="200"><label>Link (https, optional)</label><input id="a_link"></section>

<section><h2>New version notice</h2><p class="sub">Shown to apps older than this version. Empty = no notice.</p>
<div class="grid"><div><label>Latest version</label><input id="u_version" placeholder="0.7.0"></div><div><label>Download link</label><input id="u_url"></div></div>
<label>Message (optional)</label><input id="u_msg" maxlength="160"></section>

<section><h2>Advanced: raw JSON</h2><p class="sub">Exactly what's published. Edit here, then "Load JSON into form".</p><textarea id="raw" style="min-height:220px"></textarea><button onclick="loadRaw()">Load JSON into form</button></section>

<section><h2>History</h2><table id="history"></table></section>
</main>
<div class="bar"><div class="in"><input id="note" placeholder="What changed? (for history)"><button class="primary" onclick="publish()">Publish</button><span id="msg"></span></div></div>
<script>
const META = ${data};
let cfg = null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const opt = (list, v) => list.map((x) => '<option' + (x === v ? " selected" : "") + ">" + esc(x) + "</option>").join("");
const KINDS = ["", "expense", "investment", "transfer", "income", "refund"];

async function load() {
  const r = await fetch("/admin/api/config"); const d = await r.json();
  cfg = d.current; render(); renderHistory(d.history);
}
function render() {
  $("tabs").innerHTML = cfg.tabs.map((t, i) => '<tr><td>' + (i + 1) + '</td><td><input data-tab="' + i + '" value="' + esc(t.label) + '" maxlength="16"></td><td><label><input type="checkbox" class="chk" data-vis="' + i + '"' + (t.visible ? " checked" : "") + (t.id === "today" ? " disabled" : "") + "> show</label></td><td>" + esc(t.id) + '</td><td><button class="x" onclick="moveTab(' + i + ',-1)">↑</button> <button class="x" onclick="moveTab(' + i + ',1)">↓</button></td></tr>').join("");
  $("screens").innerHTML = META.screenIds.map((s) => { const v = cfg.screens[s] || {}; return '<tr><td style="width:90px">' + s + '</td><td><input data-st="' + s + '" placeholder="Title" value="' + esc(v.title) + '" maxlength="40"></td><td><input data-ss="' + s + '" placeholder="Subtitle" value="' + esc(v.subtitle) + '" maxlength="120"></td></tr>'; }).join("");
  $("rules").querySelector("tbody").innerHTML = cfg.rules.map((r, i) => ruleRow(r, i)).join("");
  $("disabledRules").value = cfg.disabledRules.join("\\n");
  $("merchants").querySelector("tbody").innerHTML = cfg.merchants.map((m, i) => pairRow("merchants", i, m.contains, m.name, "contains", "name")).join("");
  $("banks").querySelector("tbody").innerHTML = cfg.banks.map((b, i) => pairRow("banks", i, b.sender, b.bank, "sender ID", "bank name")).join("");
  $("smsIgnore").value = cfg.smsIgnore.join("\\n");
  const B = { lateSalaryDay: "Salary counts for next month from day", bigCreditRupees: "…if it's at least (₹)", nightBriefHour: "Night brief from (hour, IST)", insightMinRupees: "Insight: minimum change (₹)", insightRisePct: "Insight: minimum rise (%)" };
  $("budget").innerHTML = Object.keys(B).map((k) => '<div><label>' + B[k] + '</label><input type="number" data-b="' + k + '" value="' + cfg.budget[k] + '"></div>').join("");
  $("features").innerHTML = Object.keys(cfg.features).map((k) => '<label><input type="checkbox" class="chk" data-f="' + k + '"' + (cfg.features[k] ? " checked" : "") + "> " + k + "</label>").join("");
  const a = cfg.announcement || {}; $("a_id").value = a.id || ""; $("a_text").value = a.text || ""; $("a_link").value = a.link || ""; $("a_tone").value = a.tone || "info";
  const u = cfg.update || {}; $("u_version").value = u.latestVersion || ""; $("u_url").value = u.url || ""; $("u_msg").value = u.message || "";
  $("raw").value = JSON.stringify(cfg, null, 2);
}
function ruleRow(r, i) {
  const tags = (META.tags[r.category] || []);
  return '<tr data-rule="' + i + '"><td><input data-k="contains" value="' + esc(r.contains) + '"></td><td><select data-k="category">' + opt(META.categories, r.category) + '</select></td><td><input data-k="tag" list="tags-' + i + '" value="' + esc(r.tag) + '"><datalist id="tags-' + i + '">' + tags.map((t) => "<option>" + esc(t) + "</option>").join("") + '</datalist></td><td><select data-k="kind">' + opt(KINDS, r.kind || "") + '</select></td><td><select data-k="direction">' + opt(["", "in", "out"], r.direction || "") + '</select></td><td><input type="number" data-k="priority" value="' + (r.priority ?? 5) + '" style="width:70px"></td><td><button class="x" onclick="cfg=collect();cfg.rules.splice(' + i + ',1);render()">✕</button></td></tr>';
}
function pairRow(list, i, a, b, pa, pb) {
  return '<tr data-' + list + '="' + i + '"><td><input data-a value="' + esc(a) + '" placeholder="' + pa + '"></td><td><input data-b2 value="' + esc(b) + '" placeholder="' + pb + '"></td><td><button class="x" onclick="cfg=collect();cfg.' + list + '.splice(' + i + ',1);render()">✕</button></td></tr>';
}
function addRule() { cfg = collect(); cfg.rules.push({ contains: "", category: "Other", priority: 5 }); render(); }
function addPair(list) { cfg = collect(); cfg[list].push(list === "banks" ? { sender: "", bank: "" } : { contains: "", name: "" }); render(); }
function moveTab(i, d) { cfg = collect(); const j = i + d; if (j < 0 || j >= cfg.tabs.length) return; [cfg.tabs[i], cfg.tabs[j]] = [cfg.tabs[j], cfg.tabs[i]]; render(); }
const lines = (id) => $(id).value.split("\\n").map((s) => s.trim()).filter(Boolean);
function collect() {
  const c = JSON.parse(JSON.stringify(cfg));
  c.tabs.forEach((t, i) => { t.label = document.querySelector('[data-tab="' + i + '"]').value; t.visible = t.id === "today" || document.querySelector('[data-vis="' + i + '"]').checked; });
  c.screens = {}; META.screenIds.forEach((s) => { const t = document.querySelector('[data-st="' + s + '"]').value.trim(), st = document.querySelector('[data-ss="' + s + '"]').value.trim(); if (t || st) c.screens[s] = { title: t || undefined, subtitle: st || undefined }; });
  c.rules = [...document.querySelectorAll("[data-rule]")].map((tr) => { const g = (k) => tr.querySelector('[data-k="' + k + '"]').value.trim(); return { contains: g("contains"), category: g("category"), tag: g("tag") || undefined, kind: g("kind") || undefined, direction: g("direction") || undefined, priority: Number(g("priority")) }; });
  c.disabledRules = lines("disabledRules");
  c.merchants = [...document.querySelectorAll("[data-merchants]")].map((tr) => ({ contains: tr.querySelector("[data-a]").value.trim(), name: tr.querySelector("[data-b2]").value.trim() }));
  c.banks = [...document.querySelectorAll("[data-banks]")].map((tr) => ({ sender: tr.querySelector("[data-a]").value.trim(), bank: tr.querySelector("[data-b2]").value.trim() }));
  c.smsIgnore = lines("smsIgnore");
  document.querySelectorAll("[data-b]").forEach((el) => (c.budget[el.dataset.b] = Number(el.value)));
  document.querySelectorAll("[data-f]").forEach((el) => (c.features[el.dataset.f] = el.checked));
  c.announcement = $("a_text").value.trim() ? { id: $("a_id").value.trim() || "a" + Date.now(), text: $("a_text").value.trim(), link: $("a_link").value.trim() || undefined, tone: $("a_tone").value } : null;
  c.update = $("u_version").value.trim() ? { latestVersion: $("u_version").value.trim(), url: $("u_url").value.trim(), message: $("u_msg").value.trim() || undefined } : null;
  return c;
}
function loadRaw() { try { cfg = JSON.parse($("raw").value); render(); msg("Loaded. Review, then Publish.", true); } catch (e) { msg("That isn't valid JSON: " + e.message); } }
function msg(t, ok) { $("msg").className = ok ? "ok" : "err"; $("msg").textContent = t; }
async function post(path, body) { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.json(); }
async function publish() {
  const c = collect(); const d = await post("/admin/api/publish", { config: c, note: $("note").value });
  if (!d.ok) return msg("Not published:\\n" + d.errors.join("\\n"));
  msg("Published v" + d.config.version, true); $("note").value = ""; load();
}
async function rollback(v) { if (!confirm("Publish version " + v + " again as the newest version?")) return; const d = await post("/admin/api/rollback", { version: v }); d.ok ? (msg("Rolled back to v" + v, true), load()) : msg(d.errors.join("\\n")); }
function renderHistory(h) { $("history").innerHTML = h.length ? h.map((x) => "<tr><td>v" + x.version + "</td><td>" + esc(new Date(x.publishedAt).toLocaleString()) + "</td><td>" + esc(x.note) + '</td><td><button class="x" onclick="rollback(' + x.version + ')">Roll back to this</button></td></tr>').join("") : '<tr><td class="sub">Nothing published yet: apps use the built-in defaults.</td></tr>'; }
load();
</script></body></html>`;
}
