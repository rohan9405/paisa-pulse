/**
 * The admin editor: one self-contained page. Its script runs only with the
 * per-request CSP nonce; there are no inline handlers and no external scripts.
 * Publishing signs the config in the browser with the owner's key file, which
 * is read locally and never uploaded.
 */
export function adminPage(meta: unknown, nonce: string): string {
  const data = JSON.stringify(meta).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>drip admin</title>
<style>
:root{--bg:#07070a;--card:#13131a;--line:#262631;--text:#e8e8ef;--muted:#8b8b9e;--lime:#c6ff3d;--coral:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
main{max-width:920px;margin:auto;padding:20px 16px 130px}h1{margin:0 0 4px}h2{font-size:16px;margin:0 0 4px}
.sub{color:var(--muted);font-size:13px;margin:0 0 12px}section{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:14px 0}
input,select,textarea{background:#0d0d12;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:inherit;width:100%}
textarea{min-height:80px;font-family:ui-monospace,monospace;font-size:13px}label{font-size:13px;color:var(--muted)}
table{width:100%;border-collapse:collapse}td,th{padding:4px;text-align:left;font-size:13px;vertical-align:middle}th{color:var(--muted);font-weight:500}
button{background:#1a1a23;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 12px;font:inherit;cursor:pointer}
button.primary{background:var(--lime);color:#07070a;border:0;font-weight:700}button.x{padding:4px 9px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.bar{position:fixed;inset:auto 0 0 0;background:#0d0d12ee;border-top:1px solid var(--line);padding:12px 16px}.bar .in{max-width:920px;margin:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.err{color:var(--coral);font-size:13px;white-space:pre-wrap}.ok{color:var(--lime);font-size:13px}.chk{width:auto}.key{font-size:13px}
</style></head><body><main>
<h1>drip admin</h1><p class="sub">Settings only: never put anyone's transactions or personal data here. Apps accept a change only if it's signed with your key file, and pick it up the next time they open.</p>

<section><h2>Bottom tabs</h2><p class="sub">Order, names and which to show. Today is always shown.</p><table id="tabs"></table></section>
<section><h2>Screen titles</h2><p class="sub">Leave empty to keep the app's own text. Today's title replaces the greeting.</p><table id="screens"></table></section>
<section><h2>Categorisation rules</h2><p class="sub">If the merchant or SMS contains the text, it gets this category. Built-ins are priority 0, a user's own rules 10.</p>
<table id="rules"><thead><tr><th>Contains</th><th>Category</th><th>Tag</th><th>Kind</th><th>Money</th><th>Priority</th><th></th></tr></thead><tbody></tbody></table>
<button data-action="add-rule">+ Rule</button>
<p><label><input type="checkbox" class="chk" id="replaceRules"> Use only these rules (the app's built-in list is then just the offline fallback)</label></p>
<p class="sub" style="margin-top:12px">Switch off built-in rules (one pattern per line, e.g. <code>ola</code>):</p><textarea id="disabledRules"></textarea></section>
<section><h2>Merchant names</h2><p class="sub">Text contains → name shown in the app (e.g. "bundl" → Swiggy).</p><p class="sub">"Whole word" for short names, so "ola" doesn't match "coca cola".</p>
<table id="merchants"><tbody></tbody></table><button data-action="add-pair" data-list="merchants">+ Name</button>
<p><label><input type="checkbox" class="chk" id="replaceMerchants"> Use only these names (the app's built-in list is then just the offline fallback)</label></p></section>
<section><h2>Bank SMS senders</h2><p class="sub">Add a bank by its SMS sender ID, the part between the dashes (VM-<b>YESBNK</b>-S). Must contain letters.</p><table id="banks"><tbody></tbody></table><button data-action="add-pair" data-list="banks">+ Bank</button></section>
<section><h2>Ignore SMS containing</h2><p class="sub">One phrase per line. Matching bank SMS are never read as transactions.</p><textarea id="smsIgnore"></textarea></section>
<section><h2>Budget and insights</h2><div class="grid" id="budget"></div></section>
<section><h2>Features</h2><p class="sub">Switch a feature off for everyone (e.g. while fixing a bug). Turning off app lock only hides its switch; it never unlocks anyone's app.</p><div class="grid" id="features"></div></section>
<section><h2>Announcement</h2><p class="sub">A banner on Today. Change the id to show it again to people who dismissed it. Empty text = no banner. Links must start <span id="linkhint"></span>.</p>
<div class="grid"><div><label>Id</label><input id="a_id"></div><div><label>Tone</label><select id="a_tone"><option>info</option><option>warn</option></select></div></div>
<label>Text</label><input id="a_text" maxlength="200"><label>Link (optional)</label><input id="a_link"></section>
<section><h2>New version notice</h2><p class="sub">Shown to apps older than this version. Empty = no notice.</p>
<div class="grid"><div><label>Latest version</label><input id="u_version" placeholder="0.7.0"></div><div><label>Download link</label><input id="u_url"></div></div>
<label>Message (optional)</label><input id="u_msg" maxlength="160"></section>
<section><h2>Advanced: raw JSON</h2><textarea id="raw" style="min-height:220px"></textarea><button data-action="load-raw">Load JSON into form</button></section>
<section><h2>History</h2><p class="sub">To go back, load an old version into the editor and publish it again (it becomes the newest version).</p><table id="history"></table></section>
</main>
<div class="bar"><div class="in">
<label class="key">Signing key <input type="file" id="keyfile" accept=".jwk,application/json" style="width:auto"></label><span id="keystate" class="key">not loaded</span>
<input id="note" placeholder="What changed? (for history)" style="flex:1;min-width:200px"><button class="primary" data-action="publish">Sign and publish</button><span id="msg"></span>
</div></div>
<script nonce="${nonce}">
"use strict";
const META = ${data};
let cfg = null, signingKey = null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const opt = (list, v) => list.map((x) => "<option" + (x === v ? " selected" : "") + ">" + esc(x) + "</option>").join("");
const KINDS = ["", "expense", "investment", "transfer", "income", "refund"];
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
$("linkhint").textContent = META.allowedLinks[0];

async function load() {
  const d = await (await fetch("/admin/api/config")).json();
  cfg = d.current; render(); renderHistory(d.history);
}
function render() {
  $("tabs").innerHTML = cfg.tabs.map((t, i) => "<tr><td>" + (i + 1) + '</td><td><input data-tab="' + i + '" value="' + esc(t.label) + '" maxlength="16"></td><td><label><input type="checkbox" class="chk" data-vis="' + i + '"' + (t.visible ? " checked" : "") + (t.id === "today" ? " disabled" : "") + "> show</label></td><td>" + esc(t.id) + '</td><td><button class="x" data-action="move" data-i="' + i + '" data-d="-1">↑</button> <button class="x" data-action="move" data-i="' + i + '" data-d="1">↓</button></td></tr>').join("");
  $("screens").innerHTML = META.screenIds.map((s) => { const v = cfg.screens[s] || {}; return '<tr><td style="width:90px">' + esc(s) + '</td><td><input data-st="' + esc(s) + '" placeholder="Title" value="' + esc(v.title) + '" maxlength="40"></td><td><input data-ss="' + esc(s) + '" placeholder="Subtitle" value="' + esc(v.subtitle) + '" maxlength="120"></td></tr>'; }).join("");
  $("rules").querySelector("tbody").innerHTML = cfg.rules.map(ruleRow).join("");
  $("disabledRules").value = cfg.disabledRules.join("\\n");
  $("merchants").querySelector("tbody").innerHTML = cfg.merchants.map((m, i) => pairRow("merchants", i, m.contains, m.name, "contains", "name", m.word)).join("");
  $("replaceRules").checked = !!cfg.replaceBuiltInRules; $("replaceMerchants").checked = !!cfg.replaceBuiltInMerchants;
  $("banks").querySelector("tbody").innerHTML = cfg.banks.map((b, i) => pairRow("banks", i, b.sender, b.bank, "sender ID", "bank name")).join("");
  $("smsIgnore").value = cfg.smsIgnore.join("\\n");
  const B = { lateSalaryDay: "Salary counts for next month from day", bigCreditRupees: "…if it's at least (₹)", nightBriefHour: "Night brief from (hour, IST)", insightMinRupees: "Insight: minimum change (₹)", insightRisePct: "Insight: minimum rise (%)" };
  $("budget").innerHTML = Object.keys(B).map((k) => "<div><label>" + B[k] + '</label><input type="number" data-b="' + k + '" value="' + Number(cfg.budget[k]) + '"></div>').join("");
  $("features").innerHTML = Object.keys(cfg.features).map((k) => '<label><input type="checkbox" class="chk" data-f="' + esc(k) + '"' + (cfg.features[k] ? " checked" : "") + "> " + esc(k) + "</label>").join("");
  const a = cfg.announcement || {}; $("a_id").value = a.id || ""; $("a_text").value = a.text || ""; $("a_link").value = a.link || ""; $("a_tone").value = a.tone || "info";
  const u = cfg.update || {}; $("u_version").value = u.latestVersion || ""; $("u_url").value = u.url || ""; $("u_msg").value = u.message || "";
  $("raw").value = JSON.stringify(cfg, null, 2);
}
function ruleRow(r, i) {
  const tags = META.tags[r.category] || [];
  return '<tr data-rule="' + i + '"><td><input data-k="contains" value="' + esc(r.contains) + '"></td><td><select data-k="category">' + opt(META.categories, r.category) + '</select></td><td><input data-k="tag" list="tags-' + i + '" value="' + esc(r.tag) + '"><datalist id="tags-' + i + '">' + tags.map((t) => "<option>" + esc(t) + "</option>").join("") + '</datalist></td><td><select data-k="kind">' + opt(KINDS, r.kind || "") + '</select></td><td><select data-k="direction">' + opt(["", "in", "out"], r.direction || "") + '</select></td><td><input type="number" data-k="priority" value="' + Number(r.priority ?? 5) + '" style="width:70px"></td><td><button class="x" data-action="remove" data-list="rules" data-i="' + i + '">✕</button></td></tr>';
}
function pairRow(list, i, a, b, pa, pb, word) {
  const w = list === "merchants" ? '<td><label><input type="checkbox" class="chk" data-w' + (word ? " checked" : "") + "> whole word</label></td>" : "";
  return "<tr data-" + list + '="' + i + '"><td><input data-a value="' + esc(a) + '" placeholder="' + pa + '"></td><td><input data-b2 value="' + esc(b) + '" placeholder="' + pb + '"></td>' + w + '<td><button class="x" data-action="remove" data-list="' + list + '" data-i="' + i + '">✕</button></td></tr>';
}
const lines = (id) => $(id).value.split("\\n").map((s) => s.trim()).filter(Boolean);
function collect() {
  const c = JSON.parse(JSON.stringify(cfg));
  c.tabs.forEach((t, i) => { t.label = document.querySelector('[data-tab="' + i + '"]').value; t.visible = t.id === "today" || document.querySelector('[data-vis="' + i + '"]').checked; });
  c.screens = {}; META.screenIds.forEach((s) => { const t = document.querySelector('[data-st="' + s + '"]').value.trim(), st = document.querySelector('[data-ss="' + s + '"]').value.trim(); if (t || st) c.screens[s] = { title: t || undefined, subtitle: st || undefined }; });
  c.rules = [...document.querySelectorAll("[data-rule]")].map((tr) => { const g = (k) => tr.querySelector('[data-k="' + k + '"]').value.trim(); return { contains: g("contains"), category: g("category"), tag: g("tag") || undefined, kind: g("kind") || undefined, direction: g("direction") || undefined, priority: Number(g("priority")) }; });
  c.disabledRules = lines("disabledRules");
  c.merchants = [...document.querySelectorAll("[data-merchants]")].map((tr) => ({ contains: tr.querySelector("[data-a]").value.trim(), name: tr.querySelector("[data-b2]").value.trim(), word: tr.querySelector("[data-w]").checked || undefined }));
  c.replaceBuiltInRules = $("replaceRules").checked; c.replaceBuiltInMerchants = $("replaceMerchants").checked;
  c.banks = [...document.querySelectorAll("[data-banks]")].map((tr) => ({ sender: tr.querySelector("[data-a]").value.trim(), bank: tr.querySelector("[data-b2]").value.trim() }));
  c.smsIgnore = lines("smsIgnore");
  document.querySelectorAll("[data-b]").forEach((el) => (c.budget[el.dataset.b] = Number(el.value)));
  document.querySelectorAll("[data-f]").forEach((el) => (c.features[el.dataset.f] = el.checked));
  c.announcement = $("a_text").value.trim() ? { id: $("a_id").value.trim() || "a" + Date.now(), text: $("a_text").value.trim(), link: $("a_link").value.trim() || undefined, tone: $("a_tone").value } : null;
  c.update = $("u_version").value.trim() ? { latestVersion: $("u_version").value.trim(), url: $("u_url").value.trim(), message: $("u_msg").value.trim() || undefined } : null;
  return c;
}
function msg(t, ok) { $("msg").className = ok ? "ok" : "err"; $("msg").textContent = t; }
async function post(path, body) { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.json(); }

$("keyfile").addEventListener("change", async (e) => {
  signingKey = null; $("keystate").textContent = "not loaded";
  try {
    const jwk = JSON.parse(await e.target.files[0].text());
    if (jwk.kid !== META.kid) throw new Error("this key (" + jwk.kid + ") isn't the one the app trusts (" + META.kid + ")");
    signingKey = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    $("keystate").textContent = "loaded (stays in this tab)";
  } catch (err) { msg("Couldn't load the key: " + err.message); }
  e.target.value = "";
});

async function publish() {
  if (!signingKey) return msg("Load your signing key file first (~/.drip-private/config-signing-key.jwk).");
  const prep = await post("/admin/api/prepare", { config: collect() });
  if (!prep.ok) return msg("Not published:\\n" + prep.errors.join("\\n"));
  const sig = b64url(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, new TextEncoder().encode(prep.payload)));
  const d = await post("/admin/api/publish", { payload: prep.payload, sig, note: $("note").value });
  if (!d.ok) return msg("Not published:\\n" + d.errors.join("\\n"));
  msg("Published v" + d.version, true); $("note").value = ""; load();
}
async function loadVersion(v) {
  const d = await (await fetch("/admin/api/version/" + Number(v))).json();
  if (!d.config) return msg("Version " + v + " not found");
  cfg = d.config; render(); msg("Loaded v" + v + ". Review, then Sign and publish.", true);
}
function renderHistory(h) {
  $("history").innerHTML = h.length ? h.map((x) => "<tr><td>v" + Number(x.version) + "</td><td>" + esc(new Date(x.publishedAt).toLocaleString()) + "</td><td>" + esc(x.note) + '</td><td><button class="x" data-action="load-version" data-v="' + Number(x.version) + '">Load into editor</button></td></tr>').join("") : '<tr><td class="sub">Nothing published yet: apps use the built-in defaults.</td></tr>';
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]"); if (!b) return;
  const a = b.dataset.action;
  if (a === "publish") return publish();
  if (a === "load-version") return loadVersion(b.dataset.v);
  if (a === "load-raw") { try { cfg = JSON.parse($("raw").value); render(); msg("Loaded. Review, then Sign and publish.", true); } catch (err) { msg("That isn't valid JSON: " + err.message); } return; }
  cfg = collect();
  if (a === "add-rule") cfg.rules.push({ contains: "", category: "Other", priority: 5 });
  if (a === "add-pair") cfg[b.dataset.list].push(b.dataset.list === "banks" ? { sender: "", bank: "" } : { contains: "", name: "" });
  if (a === "remove") cfg[b.dataset.list].splice(Number(b.dataset.i), 1);
  if (a === "move") { const i = Number(b.dataset.i), j = i + Number(b.dataset.d); if (j >= 0 && j < cfg.tabs.length) [cfg.tabs[i], cfg.tabs[j]] = [cfg.tabs[j], cfg.tabs[i]]; }
  render();
});
load();
</script></body></html>`;
}
