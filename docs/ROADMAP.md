# drip roadmap

Where the app is (v0.2.0): on-device budget, bank SMS import on Android (HDFC / ICICI / SBI / Axis / Kotak), backfill from a chosen date, CSV import, demo mode. No server and no internet permission.

Effort: **S** ≈ a day · **M** ≈ 2–4 days · **L** ≈ a week or more.

---

## Answers first (items 5, 6, 9)

**Does it need a server or internet? (6)** No. The app already runs fully offline: everything is parsed and stored on the phone, and the Android app has no internet permission at all. The Mac was only used to *deliver* the APK, not to run anything. Only one roadmap item needs a server: the friends leaderboard (8). Everything else, notifications included, stays offline.

**How does it refresh? (9)** It reads new SMS when the app opens, when you switch back to it, and every 60 seconds while it's on screen. Each check reads only messages newer than the last one already read (a saved cursor), so nothing is parsed twice. Nothing runs while the app is closed, but your inbox keeps the messages, so they appear next time you open it. **Decision: no background refresh and no refresh schedule.** The only work done while closed is the morning/night brief (see Phase 3).

**Install without Wireless debugging, on any network? (5)** The APK is already downloadable from anywhere through the [GitHub release](https://github.com/rohan9405/paisa-pulse/releases/latest). What blocks the install is Play Protect, not the network. Options, in order of preference:
1. **Google Play (internal testing track).** Play's SMS policy has an exception for SMS-based money management apps, subject to a Permissions Declaration and review. A private internal-testing release installs like any Play app, updates itself, and avoids sideloading entirely. Needs a Play developer account (one-time fee), a privacy policy page and the declaration. **L**, mostly paperwork; worth it if more than one person will use the app.
2. **USB from any computer** with platform-tools: one `adb install -r`, no Wi-Fi pairing. Works anywhere.
3. **Pause Play Protect briefly** (Play Store → Play Protect → ⚙️), install, turn it back on.
4. To verify: whether Play Protect also blocks *updates* of an app that's already installed. If it doesn't, in-app "download update" would work after the first install, but it needs internet permission just for that, so it's opt-in at best.

---

## Done in 0.5.0

- **Today, redesigned:** sync status, one hero number (base · carried · spent in a line), month pace with a month-end projection, one weekly insight, the latest transactions ("N new from SMS", "Tag?" on unknown payees, "Review N"), coming-up bills with balances, and a compact streak/level row. Manual entry is a small "+ Cash spend".
- **Briefing, redesigned:** no tabs; morning brief until 5 pm, night brief after (switchable). Morning: what you can spend, yesterday in one line, anything due, insight. Night: spent vs the day's budget and what rolls over, where it went, tomorrow's allowance. Both: this week's bars, a month calendar (tap a day for its report), badges.
- **Fix:** tracking-only mode no longer shows a "deficit".

## Done in 0.4.0

- **Account balances** from "Avl bal" / "Avl limit" in bank SMS, shown on Today. Switch: Settings → Data → *Read account balances* (off also clears them).
- **Cleaner merchant names:** known brands and their legal names ("BUNDL TECHNOLOGIES" → Swiggy, "MAKEMYTRIP INDI" → MakeMyTrip), and truncated company suffixes dropped ("CHAI POINT PVT LTD" → Chai Point). Existing unedited SMS transactions are renamed on the next sync.
- **Fingerprint lock:** Settings → App → *Fingerprint lock*. Uses the phone's fingerprint or PIN; asks on open and after a minute away; hides amounts in the recent-apps preview.
- **Haptics:** light taps on buttons, a confirm buzz on saves. Settings → App → *Haptic feedback*.
- **Settings redesign:** Budget · Data · App tabs; collapsible sections show their current state, so anything is at most two taps away.

## Done in 0.3.0: data survives every update

- Updates keep all data (verified: 0.2.0 → 0.3.0 upgrade on an emulator kept transactions, settings and SMS position).
- The build refuses APKs that couldn't update the installed app (pinned signing certificate, no version downgrade).
- Automatic daily backup to a folder you choose (outside the app; survives uninstall), restore from the welcome screen or Settings. Backups now include the SMS read position, and a test fails if any future table (e.g. payee tags) is left out.
- Export, restore and CSV import now work inside the Android app (they silently did nothing before).
- Plain JSON for now; encrypting backups with a passphrase stays in Phase 4.

## Next up: screens built around auto-tracking

Most transactions now arrive by themselves, so the app's job shifts from "log your spending" to "check what came in and know where you stand". Manual entry stays, but quietly. Mockups were reviewed on 22 Oct; nothing here is built yet.

### Review inbox (centre button) · M
- The centre button of the bottom nav becomes a **review inbox** with a count badge: new transactions since you last looked, unknown merchants and unmatched refunds first.
- One card at a time: swipe right = looks right, swipe left or tap = change category.
- **Tag by payee** lives here: "Always treat payments to this payee as Rent / EMI / Investment / …" (Phase 2's tagging, in the place you naturally see each payee).
- Manual entry moves out of the spotlight: a small "+ Cash spend" on Today, a + in the Activity header, and long-press on the centre button.
- Nav: Today · Activity · **[review inbox]** · Stats · Briefing.

## Phase 1: Accuracy

### Lighter refresh · S
While the app is open, a check runs every 60 s. Today each check loads every transaction and saves a "last synced" time even when no SMS arrived, and that save makes the screen reload all data and redraw.
- Ask the inbox for new SMS first; if there are none, stop (no reads, no writes).
- Only save the "last synced" time when something was added.

### 3. Dividend income category · S
- New category **Dividend income** (kind `income`).
- Rule: a **credit** whose SMS or narration contains `ACH` (e.g. `ACH C- ITC LTD`, `ACH CR`) → Dividend income, with the company name as the merchant.
- Keep **debit** ACH/NACH separate: those are SIPs, EMIs and insurance mandates (they feed the Recurring tab).
- Applies to SMS and CSV imports; a one-off "re-categorise existing" pass fixes past transactions.

### 2a. Investment rules · S
- SIPs, **Zerodha**, **INDmoney / INDstocks**, Groww, Kuvera, mutual-fund registrars (CAMS, KFintech, BSE StAR MF, `MF`/`SIP` in NACH narrations) → **Investment**, never Bills or Savings.
- Investments stay out of "spent today" and get their own line in Stats.

### 4. Messages the parser misses · M
- ✅ **0.3.1:** UPI Lite top-ups are read as an **expense** in **Bills & Utilities** (Lite payments themselves send no SMS). Money credited from a shop or service ("from WWW MYNTRA COM") is a **refund**, not income, with a clean merchant name. A parser upgrade re-reads the inbox once: it adds missed messages, corrects unedited old ones, and never brings back deleted ones.
- **Sample messages needed:** paste a few missed SMS (the top-up one included) and they become test cases. Likely causes are an unrecognised sender ID, or wording without "debited / spent / sent" (e.g. "Rs 2000 **added to UPI Lite**").
- **"Couldn't read" inbox:** bank-sender SMS that mention an amount but didn't parse are listed in Settings → Bank SMS ("3 messages not understood"), with **Add as expense / Ignore**. Nothing gets lost silently.

## Phase 2: Money model

### 2. Budget from your real regular payments · L
Two modes, picked at setup and switchable in Settings:

**Budget mode**
- Same idea as today: regular outflows come off the top first, and what's left becomes the **daily budget**.
- The difference is where those outflows come from. You no longer type bills, savings and amounts in by hand: they're **learned from your transactions**. Investments (SIPs, Zerodha, INDmoney), rent, EMIs, fixed bills and savings, as identified by payee tags and the Recurring tab (below).
- At the start of each month the expected amounts (from last month's actual payments) are set aside. When the real payment arrives, it's matched against that reservation and doesn't hit the daily budget, as today.
- **"Don't set anything aside" option:** the daily budget is simply income ÷ days in month. It's explained cleanly with a side-by-side preview at setup and in Settings:
  > **Set aside regular payments:** ₹1,350/day. Rent day won't knock you into deficit.
  > **Don't set aside:** ₹2,580/day. Feels like more, but rent, EMIs and SIPs come out of it, so expect a big deficit on those days.

**Tracking mode**
- No budget at all: spending, categories and trends only.

**Tag by payee** (both modes)
- On any transaction: "Always treat payments to *this payee* as…" **Rent / EMI / Bills & utilities / Savings / Investment / Transfer / Ignore**.
- The key is the UPI ID or account (`ramesh@okaxis`), not the merchant text, so rent to a specific person works even with odd names.
- Tags decide what counts as a regular payment in budget mode, and roll up into Stats: **Everyday · Bills & utilities · Rent & EMI · Investments · Savings**.
- Migration: existing commitments become payee tags where a match hint exists.

### 1. Recurring & autopay tab · M
New **Recurring** tab, for awareness. In budget mode it also supplies the expected amounts that are set aside.
- **From SMS:** UPI AutoPay / e-mandate / NACH / standing-instruction messages. Today they're skipped as "not a transaction"; they'll be captured as *mandate created / modified / revoked* events instead.
- **From history:** same payee, similar amount, roughly monthly or weekly → "Looks recurring". You confirm or dismiss.
- Each entry shows payee, amount, frequency, last paid, next expected date and the source (mandate or pattern), plus a "Missed?" flag if it didn't arrive.
- Totals: "₹18,450/month committed across 9 autopays", including subscriptions (Netflix, Spotify…).

---

## Phase 3: Everyday experience

### 7. Morning & night brief notifications · M
- **Only two notifications:** a morning brief and a night brief describing your spending. No per-transaction notifications.
- **Templates are still to be decided** (you're working on these). Likely ingredients: spent yesterday / today, left to spend, top categories, biggest spend, bills or autopays due, streak.
- **Settings → Notifications:** turn each brief on or off and pick its time. Android 13+ asks for notification permission once.
- **How it works offline:** at the chosen time, Android wakes the app briefly (an exact alarm). It reads the SMS since the last check so the brief is up to date, builds the text with the existing briefing logic, and shows a local notification. No server, no internet, and nothing else runs in the background.

### Home-screen widget · S–M
"Left to spend today" (or "Spent today" in tracking mode) plus the last transaction, on the home screen without opening the app. It refreshes when the app runs and when a brief is built.

### Splash screen · S
- A native splash with the pulse logo on the app's dark background, shown while the web app loads. It uses Android 12+'s system splash, with the same look on older versions.
- It stays up until the first screen is ready, so the current blank-then-content flash goes away.

## Phase 4: Safety & insight

### Encrypt backups · S
- Automatic daily backup shipped in 0.3.0 (plain JSON). Add an optional passphrase so the backup files are encrypted; restore asks for it.

## Phase 5: Friends & leaderboard (8) · L, needs a server

Share **ratios, never amounts**:
- **What's shared, opt-in:** monthly savings rate %, investment rate %, category mix %, and a normalised weekly spending trend (shape only, no axis values). No rupee amounts, merchants or payees ever leave the phone.
- **Leaderboard:** ranked by savings % + investment % of income for the month (income comes from salary and dividend credits). Badges for streaks and "invested more than last month".
- **Connecting:** an invite code or QR; both sides approve, and either can disconnect, which deletes the shared data.
- **Backend:** a small serverless API (e.g. Cloudflare Workers + D1) storing one aggregate row per user per week. This adds internet permission, so it's off by default, and the README's privacy promise gets a clear exception for this feature.
- **No-server option:** share a signed "monthly card" (an image or link with the % figures) on WhatsApp; the friend imports it into a local leaderboard. Less live, but keeps the app fully offline. A good first step before building the backend.

---

## Later / ideas

| Idea | Why | Effort |
|---|---|---|
| **Credit card view:** spends this cycle, statement amount, due date (from statement SMS that are skipped today) | Avoid late fees; card spends vs card bill clarity | M |
| **SMS + CSV de-duplication:** same transaction from SMS and from a statement import | Avoid double-counting when using both | S |
| **Monthly report** share card / PDF | Easy review or sharing | S–M |
| **Cash wallet:** money withdrawn as cash, then spent manually | Covers spending with no SMS | M |
| **Release pipeline:** GitHub Action builds and signs the APK on a version tag (keystore as an encrypted secret) | One-step releases | S–M |
| **Real SMS test corpus:** anonymised samples per bank in the tests | Catches format changes from banks | S, ongoing |

---

## Suggested order

1. **Next up:** review inbox (centre button).
2. **Phase 1:** lighter refresh, dividend + investment rules, "couldn't read" inbox.
3. **Phase 2:** payee tags (via the review inbox), budget from regular payments with the "don't set aside" option, the Recurring tab.
4. **Phase 3:** splash screen, widget, then morning/night brief notifications once templates are ready.
5. **Phase 4:** backup encryption.
6. **Install route:** decide on Play internal testing vs USB/sideload.
7. **Phase 5:** friends, starting with the no-server share card.

**Decided:** UPI Lite top-ups → expense, Bills & Utilities · no background refresh or per-transaction notifications · budget stays, built from real regular payments, with an option not to set anything aside.

**Still open:**
- Morning/night brief templates (you).
- Whether to pursue Google Play distribution.
- Whether the friends feature gets a backend (adds internet permission) or stays share-card only.
