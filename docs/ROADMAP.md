# drip roadmap

Where the app is (v0.5.0): on-device budget, bank SMS import on Android (HDFC / ICICI / SBI / Axis / Kotak), backfill from a chosen date, CSV import, demo mode. No server and no internet permission.

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

## Built, not released yet (next: 0.6.0): money model

- **Bills and Investments are separate categories.** Rent, electricity, phone and internet, EMIs and insurance are **Bills**, each with a tag (Rent, Utility, Phone & internet, EMI, Insurance, Maintenance). SIPs, Zerodha, Groww, INDmoney, BSE StAR MF, CAMS and KFintech are **Investments** (tags SIP, Stocks, Mutual fund, NPS / PPF). Savings stays separate (RD / FD, Emergency fund).
- **Category + tag rules, by payee.** The bank SMS parser now keeps the payee's UPI ID. In a transaction, "Always use this for ramesh@okaxis" saves a rule with category *and* tag (e.g. Bills · Rent) and fixes your past payments to that UPI ID. Settings → Rules accepts a UPI ID or any text, with a tag.
- **Budget modes** (Settings → Budget mode, and at setup):
  - **Set-aside budget:** the categories you tick (Bills, Investments, Savings by default; Subscriptions and Education optional) come off income first; the rest ÷ days in the month is the daily budget. Two ways to set aside:
    - **Planned:** you enter expected amounts. Payments are matched to their planned line automatically (UPI ID, text hint, tag or name). Paying more takes the difference from that day; paying less gives it back at month end; a set-aside payment with no planned line counts in full.
    - **Actual:** nothing to enter. Each set-aside payment comes out of the month's pool when it arrives and the remaining days are recalculated; anything beyond what's left becomes a deficit.
  - **Tracking only:** no daily budget, just expenses.
- **Dividend income** tag on incoming ACH credits ("ACH C- ITC LTD"), plus Salary and Interest tags.
- **Stats:** outgoings split into Everyday · Bills · Investments · Savings; the expense breakdown leaves out Investments and Savings.
- **Recurring payments** come only from autopay / e-mandate SMS (created, changed, cancelled) or a transaction you switch to "Repeats every month". Settings → Recurring payments lists them. Today's **Coming up** shows planned bills and recurring payments due within a week, marking those due today or overdue.
- **Credit card bill payments** stay own transfers (unchanged).
- **UPI Lite top-ups** moved from Bills & Utilities to **Other · UPI Lite**: they stand in for everyday spends, and Bills are now set aside.
- **Upgrade:** existing data is migrated in place (Bills & Utilities / Rent & Housing → Bills with a tag; SIP-like savings lines → Investments; rules keep working). The SMS inbox is re-read once to pick up UPI IDs, tags and mandates. Old backups are migrated on restore.
- **Needs real samples:** the autopay/mandate SMS formats are based on typical HDFC/ICICI wording. Paste a few real ones so they become test cases.

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

## Next up: tagging without the chores

Decided 23 Oct: no review inbox tab and no badge. Tagging must take almost no effort, or nobody keeps doing it.
- **Quick-action cards** on Today (at most one, the most important) and at the top of Activity (all pending). They disappear when nothing is left.
- Card order: top-payees setup (once, after the first SMS scan: "6 payees cover 81% of your money"), new autopay found, a large or repeated payment to an unknown payee ("₹3,200 to Sunita, 3rd month. Bills · Household?"), an unmatched refund, a possible own-account transfer.
- Every card comes with a suggested answer, so "Yes" is one tap; "Something else" opens category + tag. ✕ means "leave it", and that payee isn't asked about again.
- Only ask when it changes the budget: at least ₹2,000 or 3 months in a row, a person or unknown UPI ID (not a known brand), never asked before.
- Correcting a category once remembers it for that payee, with an Undo toast (instead of the checkbox).

## Phase 1: Accuracy

### Lighter refresh · S
While the app is open, a check runs every 60 s. Today each check loads every transaction and saves a "last synced" time even when no SMS arrived, and that save makes the screen reload all data and redraw.
- Ask the inbox for new SMS first; if there are none, stop (no reads, no writes).
- Only save the "last synced" time when something was added.

### ✅ Dividend income and investment rules (built, see above)

### 4. Messages the parser misses · M
- ✅ **0.3.1:** UPI Lite top-ups are read as an **expense** in **Bills & Utilities** (Lite payments themselves send no SMS). Money credited from a shop or service ("from WWW MYNTRA COM") is a **refund**, not income, with a clean merchant name. A parser upgrade re-reads the inbox once: it adds missed messages, corrects unedited old ones, and never brings back deleted ones.
- **Sample messages needed:** paste a few missed SMS (the top-up one included) and they become test cases. Likely causes are an unrecognised sender ID, or wording without "debited / spent / sent" (e.g. "Rs 2000 **added to UPI Lite**").
- **"Couldn't read" inbox:** bank-sender SMS that mention an amount but didn't parse are listed in Settings → Bank SMS ("3 messages not understood"), with **Add as expense / Ignore**. Nothing gets lost silently.

## Phase 2: Money model

Built (see the top). Still to do:
- **Planned amounts learned from last month:** in Planned mode, offer to fill planned lines from last month's actual Bills / Investments payments instead of typing them.
- **Missed payments:** flag a recurring payment that didn't arrive within 5 days of its due date.
- **Recurring totals:** "₹18,450/month committed across 9 autopays", including subscriptions.

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
- A native splash with the drip logo (ink drop on lime) on the app's dark background, shown while the web app loads. It uses Android 12+'s system splash, with the same look on older versions.
- It stays up until the first screen is ready, so the current blank-then-content flash goes away.

## Phase 4: Safety & insight

### Encrypt backups · S
- Automatic daily backup shipped in 0.3.0 (plain JSON). Add an optional passphrase so the backup files are encrypted; restore asks for it.

## Phase 5: Friends & leaderboard (8) · L, needs a server

A fitness tracker for spending: healthy competition with friends. Share **scores and ratios, never amounts**.

**Fair by design.** Everything is measured against your *own* daily drip, like a personal move goal. Someone on ₹500/day and someone on ₹5,000/day compete equally, and nobody's income shows.

### What friends see
- **drip Score (0–100), daily:** how much of today's drip you kept, with a bonus for rollover. The leaderboard number.
- **Streaks:** "🔥 12 days under drip". One **streak freeze** earned per week, so a single wedding or emergency doesn't wipe out a month.
- **Three rings:** *Stay under* today's drip · *Skip one impulse category* (e.g. food delivery, shopping; already detected from SMS) · *Save on time* (the money set aside stayed aside). Friends see closed / not closed only.
- **Squads (3–8 friends), weekly leagues:** Duolingo-style; the top of the squad moves up a league, the bottom moves down, reset every Monday.
- **Challenges:** "No-Swiggy Week", "₹0 Weekend", "Cook 5 of 7 days". Pass/fail only, checked from SMS, so nobody can just claim it.
- **Duels:** one friend, one week, best average score wins.
- **Squad goals:** cooperative, e.g. "everyone under drip 5 of 7 days" unlocks the 💧 Hydrated badge, so the friend who's struggling gets support, not shame.
- **Reactions and nudges:** 💧 for a good day, a poke when a streak is at risk. No comments on purchases.
- **Monthly "drip Wrapped" card:** percentages and a personality ("Weekend Leaker", "Midnight Zomato Era") for Instagram stories / WhatsApp. Doubles as marketing.

### Privacy rules
- **Never leaves the phone:** rupee amounts, income, merchants, payees, bank names, individual transactions.
- **Shared, opt-in per item:** scores, streak lengths, ring flags, challenge pass/fail, percentages.
- **Inference guard:** savings % of income plus a known salary can reveal amounts, so the score is *% of daily drip kept*, not savings % of income. Category mix % stays private to you, never shown to the squad.
- **Preview before sharing:** "here's exactly what your squad sees this week". Everything is computed on the phone; only the final figures are sent.
- **Leaving deletes:** leaving a squad or disconnecting a friend deletes the shared data on the server, not just hides it.
- **No shame lists:** ranking is positive only; never "who spent the most".
- **Connecting:** an invite code or QR; both sides approve.

### Rollout
1. **No server · M:** drip Score + streaks + a daily/weekly **share card** (image or signed link) on WhatsApp; a friend imports it into a local leaderboard. The app stays fully offline. Proves people actually compete before building more.
2. **Small backend · L:** squads, leagues, duels, live streaks. A small serverless API (e.g. Cloudflare Workers + D1) storing one row per user per day: score, streak, ring flags, challenge results. This adds internet permission, so it's off by default, and the README's privacy promise gets a clear exception for this feature.

## Phase 6: Everyday delight · offline, no AI

Make drip fun to open without making anything up. Other apps either report the past (Walnut, Money Manager, Fold: month-end dashboards) or hand out fake rewards (CRED: coins, spin wheels, scratch cards). drip's rewards are **your real money or a real insight**, and they vary because your life does.

**Rules for every idea here:**
- **Zero effort:** comes from SMS the app already reads. Nothing to type.
- **Organic:** fires only when something actually happened. No random draws, no made-up points.
- **Variable:** different from day to day because spending is.
- **Offline:** plain rules and counting on the phone. No LLM, no internet; the app has no internet permission anyway. An LLM could later *reword* messages as an optional extra, with the templates as the fallback, but detection never depends on it.
- **No new notifications:** surprises appear on app open and in the Phase 3 morning/night briefs (per-transaction notifications stay off, as decided).

### "You skipped it" ⭐ · M
drip learns your habits from SMS and notices when one doesn't happen: *"No Friday order this week. ₹480 stayed with you 💧"*. No other tracker can do this without manual entry. Like Urge's "track what you skip", but automatic.
- **Learn a habit:** group outgoing spends by merchant (or UPI payee) and weekday, e.g. Zomato on Fridays in 4 of the last 5 weeks, ₹380–₹560. A habit needs at least 3 occurrences in at least 3 of the last 4–5 weeks, must be recent, and excludes bills, rent and anything in Recurring. Reuse `sameMerchant` (match.ts) and the "paid around the date" logic (recurring.ts).
- **Spot a skip:** once the habit's window has fully passed (Friday is over) with no matching spend. The amount shown is the habit's typical (median) spend.
- **Reveal:** on the next app open or in the morning brief; at most 1–2 a week so it stays special.
- **Copy:** template pools per habit type (food, cab, coffee, shopping) in the brand voice, e.g. *"Uber took the Sunday off. ₹310 stayed home 🏠"*.
- **Guards:**
  - Paid by cash or a card drip doesn't see → gentle wording (*"Looks like you skipped…"*) plus one tap "I paid another way", which hides it and teaches drip.
  - Every habit missing at once → probably travelling; stay quiet that week.
  - 3 skips in a row → no longer a habit; celebrate once (*"3 Fridays without Zomato. New era? 👀"*), then retire it.
- **Time-of-day habits** ("the 4pm coffee") need the SMS timestamp stored on each transaction (today only the date is kept). New transactions only, so these start appearing a few weeks after the update. Weekday habits work with today's data.

### Morning reveal · S
Today's drip is genuinely different every day (rollover, deficit payback, bills set aside), so opening the app becomes a daily Wordle-style moment: the drop fills to today's amount with what changed, *"+₹212 from yesterday"*.

### "What it bought" · S
Translate what you kept into something tangible, rotating so it stays fresh: *"This week's leftovers = 2 movie tickets"* · *"= 11 cutting chais"* · *"Goa trip 18% closer"*. Same real number, new framing.

### Personal records · S–M
Strava-style PRs that appear only when true: *"Cheapest Saturday this year"*, *"Longest under-drip run: 9 days"*, *"First month with zero late-night orders"*. Rare and earned, which is what makes them feel good.

### Forecast · S
Like a weather report: *"At this pace, Friday's drip is ₹1,100 ☀️"*, *"Rough weekend ahead: two bills land Saturday 🌧️"*. Helps you adjust before overspending, not after.

### The living drop · S (with the Phase 3 widget)
The widget shows a drop that's full, half or nearly empty with today's remaining drip. Information at a glance, without opening the app; a Tamagotchi whose "pet" is your real money.

### Hype or roast · S
Pick a tone (Cleo's most-loved feature is its roast mode). Large template pools triggered by real events, so lines rarely repeat: *"Third under-drip day. Who even are you 💅"* / *"Swiggy knows your address better than your mom does 💀"*. Roast the spending, never the person.

### Sunday mini-Wrapped · M
A short story-style weekly recap: best day, what you skipped, any record, next week's forecast. No finance app does Wrapped well, so it's open territory, and it's shareable without amounts (ties into the Phase 5 share card).

### Real-life moments · S
Detected from SMS, so they happen only when life does:
- **Salary lands:** *"Payday 🎉 New month, new drip: ₹1,240/day"*.
- **Month-end survived:** *"Made it to the 31st with ₹600 to spare"*.
- **Sale seasons** (Big Billion Days, Diwali): a heads-up before, a "you survived" after.

### Streaks that forgive · S
Count only real under-drip days, with one freeze earned weekly (as in NoBuy: one bad day shouldn't erase thirty good ones). Shared with Phase 5.

### What to avoid, and why
| Avoid | Why |
|---|---|
| **Coins, points, spin wheels, scratch cards, jackpots** (CRED-style) | Artificial: the reward has nothing to do with your money. Users stop caring once the novelty wears off, and coins of unclear value erode trust. |
| **Random rewards** | Variability should come from real life. A random draw feels like a slot machine, the wrong feeling for a money app. |
| **"Come back!" / streak-in-danger notifications** | Nagging, not delight. Per-transaction notifications are already ruled out; surprises live in the app and the two briefs. |
| **Badges for opening the app or tapping things** | Rewards attention, not behaviour. The only things worth celebrating are things you did with money. |
| **Shame or guilt** ("you failed", red alerts for every overspend) | People stop opening apps that make them feel bad. Roast the spending lightly, never the person, and always show the way back (deficit payback). |
| **Daily insight quotas** (a "tip of the day" whether or not there's anything to say) | Filler teaches people to ignore the app. Say something only when the data has something to say. |
| **Too many surprises** | A skip or record every day stops being a surprise. Cap reveals (1–2 skips a week) to keep them rare. |
| **Cloud AI for detection** | Needs internet and sends spending data off the phone, breaking the privacy promise. Rules and counting are enough, and work offline. |
| **Rewards that need manual entry** | The point is zero effort. If a feature only works when people log things by hand, most won't, and it quietly dies. |

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

1. **Release 0.6.0** (money model), after checking real autopay SMS samples.
2. **Next up:** quick-action cards for tagging.
3. **Phase 1:** lighter refresh, "couldn't read" inbox.
4. **Phase 2 leftovers:** planned amounts from last month, missed-payment flags, recurring totals.
5. **Phase 3:** splash screen, widget, then morning/night brief notifications once templates are ready.
6. **Phase 4:** backup encryption.
7. **Install route:** decide on Play internal testing vs USB/sideload.
8. **Phase 6:** "You skipped it" first, then morning reveal, personal records and the Sunday mini-Wrapped. All offline.
9. **Phase 5:** friends, starting with drip Score, streaks and the no-server share card.

**Decided:** UPI Lite top-ups → everyday expense (Other · UPI Lite) · no background refresh or per-transaction notifications · Bills and Investments separate, with tags · budget modes: set-aside (Planned or Actual, categories configurable) or tracking only · recurring only from mandate SMS or explicit marking · credit card bill payments are own transfers · no review inbox tab; quick-action cards instead.

**Still open:**
- Morning/night brief templates (you).
- Whether to pursue Google Play distribution.
- Whether the friends feature gets a backend (adds internet permission) or stays share-card only.
