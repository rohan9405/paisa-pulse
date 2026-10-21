# Drip roadmap

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

## Phase 1: Accuracy

### Fix: tracking-only mode shows a deficit · S
Found while testing: with no budget set, the Today screen still says "Deficit ₹370 … spend less than your base". In tracking mode there's no allowance, so there should be no deficit or recovery plan.

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

### Cleaner merchant names · S
- Map UPI IDs and truncated SMS names ("Makemytrip Indi" → "MakeMyTrip") to clean names, using a built-in list of common merchants plus your own renames.
- Renaming one transaction offers "rename all from this payee"; duplicates of the same merchant merge in Stats.

---

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

### Light haptic feedback · S
- Subtle taps on: adding an expense, saving, switching tabs, toggles, pull-to-refresh, and a soft "success" pattern when a brief or import finishes.
- Uses Android's built-in haptic feedback, which needs no extra permission and respects the phone's system haptics setting. An in-app "Haptics" switch is in Settings.

### Fingerprint app lock · S
- Unlock with fingerprint or the phone PIN when the app opens or comes back after a few minutes away (Android's BiometricPrompt).
- Off by default, switched on in Settings. Notifications and the widget can optionally hide amounts while locked.

---

## Phase 4: Safety & insight

### Encrypt backups · S
- Automatic daily backup shipped in 0.3.0 (plain JSON). Add an optional passphrase so the backup files are encrypted; restore asks for it.

### Account balances from SMS · S–M
- Read "Avl bal" / "Available balance" from bank SMS (today it's deliberately skipped when reading the amount) and keep the latest balance per account and card (by last 4 digits).
- An Accounts view shows each balance with "as of" time; card SMS show available limit.

---

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

1. **Phase 1:** lighter refresh, dividend + investment rules, UPI Lite + missed-SMS fixes, "couldn't read" inbox, merchant names.
2. **Phase 2:** payee tags, then budget-from-regular-payments (with the "don't set aside" option), then the Recurring tab.
3. **Phase 3:** splash + haptics (small, visible), app lock, widget, then morning/night briefs once templates are ready.
4. **Phase 4:** backup encryption, account balances.
5. **Install route:** decide on Play internal testing vs USB/sideload.
6. **Phase 5:** friends, starting with the no-server share card.

**Decided:** UPI Lite top-ups → expense, Bills & Utilities · no background refresh or per-transaction notifications · budget stays, built from real regular payments, with an option not to set anything aside.

**Still open:**
- Morning/night brief templates (you).
- Whether to pursue Google Play distribution.
- Whether the friends feature gets a backend (adds internet permission) or stays share-card only.
