# drip roadmap

Current checkout: **0.8.10** (24 Oct 2026). Core money tracking, recipient tagging/archive, widgets and the signed config backend are implemented. Play Store packaging is being prepared; publication/approval is not implied by a local build.

## Implemented: category drill-down and trend controls (0.8.10, build 22)

- Every Stats expense-category row links to Activity filtered by that category and the displayed month (including historical months). Week views use the month containing the period end. Filters remain editable; malformed month/category parameters are ignored.
- Today trend arrows frame a centered date range. Latest sits centered on its own reserved row, preserving chart position when it appears or disappears.
- Based on latest local main; remote fetch confirmed no missing commits. Signed update preserves phone data.

## Implemented: Net In-Hand, settlements and daily spending average (0.8.9)

- Stats headline is **Net In-Hand = income − expenses − investments**, with Income / Expenses / Investments cards. Income includes all income buckets except refunds and settlements. Expenses are net of linked reimbursements and exclude investments.
- Settlement credits link to an original expense across different payers; multiple shares are supported, with remaining-amount validation and concurrent-write protection. Unlinked credits require review and do not become income. Existing user edits and remote-rule protections remain in place.
- Savings is removed from new choices; existing data, backups and rules remain valid and display under Investments.
- Daily spending retains a single view. A dotted line shows the selected month’s daily average through the period cutoff, counting zero-spend tracked days.

## Implemented: chart navigation, heatmap and scrubbing (0.8.9, build 21)

- Built on latest local `main`, 0.8.8 at `6afdc58`; earlier work was already committed. Fetch confirmed no missing remote commits.
- Category amounts (including paise where present) are always visible beside percentages, with the same permanent colours and aligned legend rows.
- Hold and drag across bars or their date labels to inspect values. Hold and drag across the Today calendar to update the selected day's analytics continuously. Taps and keyboard activation still work. Pointer capture survives rerenders; future/untracked dates cannot be selected, and the calendar stays anchored.
- Seven-day date strip follows the supplied [reference](references/seven-day-date-strip.png): two-letter weekdays, day numbers, selected-day circle, **no dots**. Previous/next controls move by seven days; Latest restores the selected snapshot's most recent window. Earlier windows do not change the hero or calendar selection. Calendar/flow changes reset the trend window. Date ranges include years when crossing New Year.
- The month-labelled twelve-month spending heatmap is the **last Stats section, immediately below Expenses by category**. The existing planned-payment section is placed above categories. Stats period navigation determines the heatmap's ending month; horizontal panning explores the year, and tapping a day reveals the amount.
- Following the supplied [heatmap reference](references/monthly-spend-heatmap.png), one neon-green hue uses pale-to-dark steps: **higher spend = darker shade**. A common scale covers the displayed year. Recorded zero, untracked/future days and padding remain distinct. Includes bills, excludes investments/savings/transfers/income, and handles linked refunds as of the displayed month. The Today calendar retains its existing status colours.

## Planned: product presentation (not started)

Marketing assets, the README redesign and the website below remain roadmap-only. The chart updates above were subsequently authorised for implementation.

### Marketing assets and current product screens

- Review [openGym's README](https://github.com/DuarteSantos8/openGym/blob/main/README.md) and [one-page website](https://opengym.ch/) as structural references, with original drip positioning, copy and artwork.
- Lead with everyday expense tracking and less manual work: SMS imports, recipient-level tagging and remembered corrections, daily/period comparisons, upcoming payments, data control and optional budgeting.
- Plan an original branded hero/banner, polished phone compositions, concise feature panels, social preview images and store graphics. Capture a consistent, current set of Today, seven-day/calendar, Activity/Recipients, Stats, upcoming payments, widget and Settings screens using fictional data only.
- Keep one repeatable screenshot source and shared assets for the repository, release/store listing and website. Do not copy openGym's product photos, branding, feature claims or layouts wholesale.

### README structure and gaps to close

- Proposed order: branded hero + concise pitch; verified release/platform links; captioned screenshot gallery; why drip; benefits grouped by tracking, insights, automation and data ownership; quick start/install; browser demo; privacy/data flow; backup/import; development; roadmap/changelog; support/contributing/license links where applicable.
- Gaps in the current README: budget-first introduction despite tracking mode; no polished branded banner; screenshots not uniformly current; no concise “why drip” story or clear benefit groups; no public demo/website entry point; release/status links and support/contribution documentation need a consistency pass.
- Match claims to the latest implementation. In particular, 0.8.8 has optional anonymous usage counters: describe their controls and data boundaries accurately rather than copying a “no telemetry” promise. Do not claim a store release, license, sync or platform support that has not been verified.

### One-page drip website

- Plan a mobile-first page with an original daily-tracking pitch, download and demo calls to action, selected feature stories, swipeable current screenshots, a fictional-data interactive demo if practical, install requirements, privacy/data ownership, backups, FAQs and project/support links.
- Borrow the reference's progression from value proposition to product proof to trying/downloading the app; retain drip's minimal dark theme and typography. Link documentation and truthful release status. Keep personal financial data out of marketing assets and the public demo.
- Execution order: agree the tracking-first pitch → review the completed chart UI → refresh product captures → create original marketing assets → restructure README → build/review the landing page → publish only when authorised.

## Config-owned merchant markers (0.8.5, build 17)

- Parser, rule and merchant-name fixes are made in the config store and published, not hardcoded in the app.
- New config field `merchantMarkers` (editor: Merchant names → Merchant markers): plain text that comes right before the merchant name in a debit SMS. The app only has the mechanism; the list is config-only. Config v5 adds `VIN*` (ICICI debit card: “on 21-Oct-26 VIN*Google Pl.”) and the merchant name `googlepl` → Google Play, replacing `googleplay`.
- Clients older than 0.8.5 ignore the markers field, and their merchants are still named by the config's name list.

## Category alignment fix (0.8.4, build 16)

- Category dots, names and percentages share one grid row; tap-to-show amounts occupy a reserved second row.
- Permanent muted colours cover every built-in category, shared by Today and Stats; no sort-order or hash assignments and no reserved violet/lime/coral/amber status colours. Custom unknown categories use the neutral Other fallback. Income-source tags retain the Income category colour.
- 218 unit tests and TypeScript pass. Signed 0.8.4 (build 16) installed over the existing phone app on 24 Oct with data retained; installed version and launch verified.

## Implemented 24 Oct: unified Today

- Today and Brief share one scrollable screen. The separate Brief tab and morning/night copy are removed; old Brief links still open Today, including dated links. Legacy remote primary `briefing` maps to Today. Other primary actions retain their raised highlight; selected navigation uses colour only, without a dot.
- Visual polish: category percentages share one segmented colour strip; Week / Month tabs (default Month) display one comparison bar at a time; current vs smaller previous-period amount uses “last month/week”, with “(till date)” in the current-period title. Comparisons each use one bar with a prior-period marker and a coloured difference (lower spending / higher income green, the reverse red). Week comparison covers the same weekdays last week. Usual/day and budget available are removed from Today. The hero has a percentage versus the previous 28 completed days’ daily average (compact “28d avg” label); category taps reveal amounts without shifting layout. Rolling seven-day bars use green/yellow/red relative to the displayed rolling seven days’ average, with a dotted average line and a compact label. The calendar has five green/yellow/red spend-intensity levels and a lime selection outline.
- Spent / Income switch shares selected-day totals and breakdown, week-to-date, rolling seven-day trend, month cumulative and last month through the comparable day. Bills count as expenses; investments, savings, transfers and refund credits do not count as income. Future transactions/refunds never leak into historical snapshots.
- At most one category-pattern insight, shown only with sufficient history and a meaningful change. No generic morning brief or filler insight. Rolling seven-day bars reveal values on tap.
- Calendar uses six fixed rows and preserves its viewport position when selecting a date or browsing months. Selection updates all historical analytics; daily transactions are expandable. Upcoming payments and reported balances remain explicitly current.
- Verified with 217 unit tests, TypeScript, production static export and browser demo checks (income, historical snapshots, calendar position and bar values). Signed 0.8.3 (build 15) installed over the existing phone app on 24 Oct with data retained; installed version and launch verified.

- **Documentation/config rollout:** Today and calendar screenshots refreshed; README and screenshot regeneration script match the unified screen. Config editor deployed as `88d4b1c5-d69e-48ca-8775-2a6a437c2f88`: five navigation options, legacy Brief/night settings hidden and retained for compatibility. No global config was published and no rule/history settings changed.

## Implemented 24 Oct: tracking, safe rules, IPOs and navigation

- **Track expenses** is distinct from **Daily budget (Actual or Planned)**. Tracking's Today, month/week summaries, briefings and widget count actual expenses including Bills. Investments, Savings and own transfers stay separate. No allowance, rollover, deficit, budget target or budget upsell on the tracking home screen. Mode changes retain dated history.
- **Six configurable navigation actions:** Today, Brief, Manual log, Activity, Stats and Settings. The remote editor controls order, labels, visibility and exactly one highlighted primary action. Every action supports the same raised lime treatment; the active page has its own indicator. Manual log opens a sheet. Today is the fallback and remains accessible.
- **Remote rules default to future transactions only.** Publishing text/navigation/features or changing a rule never re-reads the inbox. Each remote rule has an explicit **Apply to past 12 months** checkbox and history revision. Opt-in jobs use stored transactions and a date index, run once per rule change/revision, and do not reprocess history for unrelated publishes. Nothing older than twelve months is rewritten.
- **User control wins:** matching personal rules take precedence over all global rule priorities. User-added rules survive global replacement/removal; editing a built-in creates a personal copy. User-edited transactions (including legacy edits) and linked payments are protected from remote history jobs. Parser upgrades no longer automatically reclassify old transactions.
- **Lighter SMS refresh:** check the cursor/inbox before loading rules or transaction history. Empty minute ticks do no full-table reads or database writes and do not change last-sync time. Only explicit earlier tracking start or re-enabling balance reads backfills SMS; a balance-only rescan never reclassifies transactions. New messages retain deduplication and deleted-payment protection.
- **IPO holds:** completed IPO/ASBA block, allotment-debit, release and cancellation messages are tracked as events in a separate backed-up holds table. Blocks/releases are not expenses or income; only a settled debit creates Investments · IPO. Partial allotments, repeated confirmations and bank/account/reference separation are handled. Cancellation/expiry does not imply release; ambiguous or incomplete events remain marked for review. Today shows open blocks; Activity includes settled history. Bank-reported available balances are not reduced a second time.
- **Recurring accuracy:** no missing-frequency → monthly guess. Daily/weekly/monthly/quarterly/half-yearly/yearly schedules retain their anchor and month-end clamping; one-time and unknown mandates are excluded from recurring reminders. Separate mandate references stay separate, and one ambiguous payment cannot clear multiple mandates. Payments not seen after five days stay visible. Frequency and due day can be corrected locally; removing a reminder keeps a tombstone. Unverified schedules from the old parser migrate to unconfirmed, preserving the records.

**Verification (24 Oct):** 210 unit tests, app/backend type checks and all 24 mobile/desktop browser tests passed. Signed 0.8.1 (build 13) installed over the existing phone app with its data retained; launch and six-action navigation verified. The config-editor code is deployed; no global config was published and no historical-rule job was enabled by deployment.

**Still to validate with real samples:** bank-specific IPO/ASBA wording, identifiers and revised/partial settlements. Unsupported wording is not guessed; no claim of universal IPO or mandate coverage.

**Remote rollout:** the new primary-action and per-rule-history controls require the updated client and config backend. Deploying editor code does not publish a new global config or opt any rule into history. Older clients retain their old behaviour until updated.

## In progress / next

- Finish Play Store release packaging and account/policy submission (privacy/assets/AAB work is present; store approval remains external).
- Real anonymised bank SMS fixtures; “could not read” recovery; broader bank coverage.
- Confirm IPO and recurring edge cases on actual devices and add formats from samples.
- Scheduled notifications remain unimplemented; any future notification should add information beyond the unified Today view.
- Planned amounts suggested from last month; encrypted backups.
- Gmail/cross-source reconciliation, currencies, card rewards and social features remain future work.

The older phased sections below retain design context; the dated status above takes precedence over outdated “next release” labels.


Effort: **S** ≈ a day · **M** ≈ 2–4 days · **L** ≈ a week or more.

---

## Answers first (items 5, 6, 9)

**Does it need a server or internet? (6)** Not for your data. (Since 0.7.0 the app downloads one settings file from the config backend; nothing is uploaded.) Transaction parsing and storage work offline. Internet access is restricted to downloading signed global config; personal financial data is not uploaded. The Mac was only used to *deliver* the APK, not to run anything. The friends leaderboard (8) needs a server. Planned Gmail import also needs opt-in internet access; its authentication and sync architecture still needs a decision. Currency conversion can stay offline with manually entered or imported rates; automatic rate updates would also need opt-in internet. The existing SMS import, budget, and planned local notifications stay offline.

**How does it refresh? (9)** It reads new SMS when the app opens, when you switch back to it, and every 60 seconds while it's on screen. Each check reads only messages newer than the last one already read (a saved cursor), so nothing is parsed twice. Nothing runs while the app is closed, but your inbox keeps the messages, so they appear next time you open it. **Decision: no background refresh and no refresh schedule.** The only work done while closed is the morning/night brief (see Phase 3).

**Install without Wireless debugging, on any network? (5)** The APK is already downloadable from anywhere through the [GitHub release](https://github.com/rohan9405/paisa-pulse/releases/latest). What blocks the install is Play Protect, not the network. Options, in order of preference:
1. **Google Play (internal testing track).** Play's SMS policy has an exception for SMS-based money management apps, subject to a Permissions Declaration and review. A private internal-testing release installs like any Play app, updates itself, and avoids sideloading entirely. Needs a Play developer account (one-time fee), a privacy policy page and the declaration. **L**, mostly paperwork; worth it if more than one person will use the app.
2. **USB from any computer** with platform-tools: one `adb install -r`, no Wi-Fi pairing. Works anywhere.
3. **Pause Play Protect briefly** (Play Store → Play Protect → ⚙️), install, turn it back on.
4. To verify: whether Play Protect also blocks *updates* of an app that's already installed. If it doesn't, in-app "download update" would work after the first install, but it needs internet permission just for that, so it's opt-in at best.

---

## Money model (implemented; earlier release notes)

- **Bills and Investments are separate categories.** Rent, electricity, phone and internet, EMIs and insurance are **Bills**, each with a tag (Rent, Utility, Phone & internet, EMI, Insurance, Maintenance). SIPs, Zerodha, Groww, INDmoney, BSE StAR MF, CAMS and KFintech are **Investments** (tags SIP, Stocks, Mutual fund, NPS / PPF). Savings stays separate (RD / FD, Emergency fund).
- **Category + tag rules, by payee.** The bank SMS parser now keeps the payee's UPI ID. In a transaction, "Always use this for ramesh@okaxis" saves a rule with category *and* tag (e.g. Bills · Rent) and fixes your past payments to that UPI ID. Settings → Rules accepts a UPI ID or any text, with a tag.
- **Budget modes** (Settings → Budget mode, and at setup):
  - **Set-aside budget:** the categories you tick (Bills, Investments, Savings by default; Subscriptions and Education optional) come off income first; the rest ÷ days in the month is the daily budget. Two ways to set aside:
    - **Planned:** you enter expected amounts. Payments are matched to their planned line automatically (UPI ID, text hint, tag or name). Paying more takes the difference from that day; paying less gives it back at month end; a set-aside payment with no planned line counts in full.
    - **Actual:** no income or planned amount inputs. Recorded income funds the pool; tagged set-aside payments reduce it and the remaining days are recalculated; anything beyond what's left becomes a deficit.
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

### ✅ Lighter refresh (implemented 24 Oct)
While the app is open, a check runs every 60 s. The cursor/inbox probe now happens before rule/transaction table reads; unchanged polls do not write or redraw the data snapshot.
- Ask the inbox for new SMS first; if there are none, stop (no reads, no writes).
- Only save the "last synced" time when something was added.

### ✅ Dividend income and investment rules (built, see above)

### 4. Messages the parser misses · M
- ✅ **0.3.1:** UPI Lite top-ups are read as an **expense** in **Bills & Utilities** (Lite payments themselves send no SMS). Money credited from a shop or service ("from WWW MYNTRA COM") is a **refund**, not income, with a clean merchant name. A parser upgrade re-reads the inbox once: it adds missed messages, corrects unedited old ones, and never brings back deleted ones.
- **Sample messages needed:** paste a few missed SMS (the top-up one included) and they become test cases. Likely causes are an unrecognised sender ID, or wording without "debited / spent / sent" (e.g. "Rs 2000 **added to UPI Lite**").
- **"Couldn't read" inbox:** bank-sender SMS that mention an amount but didn't parse are listed in Settings → Bank SMS ("3 messages not understood"), with **Add as expense / Ignore**. Nothing gets lost silently.

## Added 23 Oct: currencies, email, rewards and bank coverage

These are planned features, not implemented. Build shared source reconciliation and currency-aware amounts before combining new feeds into totals.

### Broader bank SMS coverage · M per batch, ongoing
- Extend the current HDFC / ICICI / SBI / Axis / Kotak support to more banks and more formats from existing banks, including credit cards, refunds, international purchases, fees and mandate changes.
- Choose each batch from real anonymised samples; keep a bank/format coverage matrix and regression fixtures. Do not claim support for an entire bank from one sample.
- Normalise sender variants, references, masked account/card IDs, timestamps and currency into the same transaction model. Unsupported messages go to the “couldn't read” inbox; never silently assume INR for an unknown currency.
- Reprocessing adds missed transactions and enriches existing ones while preserving edits, ignored messages and deleted transactions.

### Multiple Gmail accounts + cross-source deduplication · L
- Connect multiple Gmail accounts independently, each with explicit consent, its own sync cursor, status, backfill date and disconnect control. Import supported financial alerts only; expose which account and message supplied each record.
- **One transaction, multiple pieces of evidence:** an SMS, bank email, card email or statement describing the same payment must enrich one canonical transaction, not create additional spending. Retain all source links and import IDs for audit and safe re-sync.
- Match strong bank/network references with account/card identity first. Without a shared reference, use amount **and currency**, direction, account/card, merchant and a bounded time window; suggest uncertain matches for confirmation. Equal amounts on the same day alone are insufficient.
- Distinguish pending authorisations from posted payments, refunds from duplicate alerts, and card purchases from credit-card bill payments. Preserve user corrections; allow merge undo and recovery from a false match. Reconnect/backfill must be idempotent.
- Disconnect stops access and removes credentials; offer a separate explicit choice to remove imported evidence. Keep a transaction if other source evidence or a manual record still supports it.
- **Privacy change:** Gmail requires opt-in internet access and authentication. Decide device-side versus backend sync, credential storage, permissions and retention before implementation; update the no-internet promise and onboarding accordingly. SMS-only use must remain available offline. No scheduled email sync is implied by this item.

### Multi-currency support · L
- Choose a reporting/base currency; retain every original amount and ISO currency code. Replace INR-only paise assumptions with integer minor units appropriate to each currency, including currencies with zero or three decimal places.
- Store original purchase currency and settled card/account currency when both are known. They describe one purchase, not two expenses. Capture FX fees separately when explicitly reported.
- For combined totals, use the actual settled base amount when available; otherwise use a stored dated conversion rate with source and rounding rules. Show original and converted amounts and label estimates. Missing rates remain visible as unconverted amounts, never silently omitted or added across currencies.
- Manual/imported rates work offline; automatic historical rates are a separate opt-in internet feature. Freeze booked conversions so refreshing rates does not silently rewrite past reports. Changing base currency requires an explicit historical conversion policy and preview.
- Match cross-currency own-account transfers as linked legs, keeping fees separate. Migrate existing amounts as INR without changing their values; include currencies, rates and source evidence in backup/export/restore.
- **Budget mode:** income, planned lines, daily allowance and rollover use the base currency. **Tracking only:** conversions are for reporting; no allowance or FX-driven deficit is created.

### Credit card points tracking · M–L
- Per-card/rewards-program view: reported points balance with an as-of date, earned/redeemed/expired/adjusted points, and upcoming expiry when a source provides it. Start with manual updates and supported SMS/email/statement formats.
- Keep points in their own units and ledger, separate from cash spending, income and budget. A balance snapshot reconciles the ledger; it must not be counted as new earned points.
- Optional earning estimates need versioned card rules, exclusions, caps and refund reversals. Mark estimates separately from issuer-confirmed points and show unknowns rather than inventing accrual or expiry.
- Deduplicate reward events across email, SMS and statements. Redemption is a points movement; only a separately confirmed cash credit affects the money ledger, once.
- Optional redemption value estimates must state their assumption and must not inflate available cash. Works equally in tracking-only and budget modes.

## Tracking-only: behavior across the product

Tracking-only is a full money-tracking experience with no allowance or budget judgement. Income transactions may still be imported and reported; a salary is not required to use it. New plans store an explicit tracking/set-aside choice; actual set-aside can have null planned income without being mistaken for tracking.

| Area | Tracking-only behavior |
|---|---|
| Setup / Settings | Hide salary, set-aside and planned-payment amount inputs. Keep tracking start, accounts and import controls. Existing recurring reminders remain available. |
| Today | “Spent today”, usual daily spend and this week's spend replace “Left to spend”, base, carried balance and deficit. Label everyday spend clearly; show Bills / Investments / Savings separately so a rent day is not mistaken for no outgoings. |
| Month pace / Stats | Show actual spending, income, outgoings, category mix and comparable prior periods. Hide allowance lines, budget progress, “on track”, remaining pool and deficit recovery. Investments / Savings remain separate from expenses; own-account transfers remain excluded. |
| Briefings / widget | Morning: yesterday's spend, notable changes and payments due. Night: actual spend, categories and biggest payment. Widget: “Spent today”. No “safe to spend”, rollover or tomorrow's allowance. Notifications follow the same mode-specific copy. |
| Bills / recurring | Keep due/overdue reminders, missed-payment detection and committed monthly totals. “Due” never implies money has been reserved; hide “already set aside” copy. |
| Tagging | Keep categories, tags, payee rules, refunds and transfer corrections. Ask when it materially improves reports or recurring detection, rather than only when it changes a budget. Retain the low-effort thresholds and dismiss behavior. |
| Imports / currencies / points | SMS, CSV, future multi-account Gmail, source deduplication, FX reporting and credit-card points all work without a budget. |
| Insights / rewards / friends | Keep factual comparisons, habit changes and optional no-spend records. Hide under-budget streaks, budget XP, drip Score, allowance rings and budget-ranked leagues; no invented score when there is no allowance. Sharing can show an explicitly chosen factual summary. |
| Switching modes | Preserve transactions, rules, accounts, rewards and source links. Keep dated plan history. Budget activation after tracking starts at zero on the effective date; earlier tracking spending does not become a deficit. |

**Implemented 23 Oct:** tracking and actual setup skip all budget amount inputs; planned setup retains income and planned lines. Tagging and automatic rules remain shared. Tracking balances stay zero; activation after tracking starts a fresh budget period. Actual mode uses received income, not an entered estimate. Reports retain each day's mode, label everyday spending, show other outgoings separately, and hide tracking budget/XP copy. Regression tests cover mode changes, actual income and tracking tagging. Future quick-action cards must use report/recurring relevance in tracking mode.

## Phase 2: Money model

Built (see the top). Still to do:
- **Planned amounts learned from last month:** in Planned mode, offer to fill planned lines from last month's actual Bills / Investments payments instead of typing them.
- ✅ **Missed payments:** payments not seen after five days remain visible; incomplete SMS coverage is not treated as proof of non-payment.
- ✅ **Recurring totals:** confirmed frequencies contribute a monthly equivalent, labelled “up to” because mandate amounts can be caps; unconfirmed schedules are counted separately.

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
- **Offline:** plain rules and counting on the phone. No LLM, and nothing leaves the phone (the app's internet is download-only, for its settings). An LLM could later *reword* messages as an optional extra, with the templates as the fallback, but detection never depends on it.
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
3. **Phase 1:** lighter refresh, "couldn't read" inbox, broader bank SMS formats backed by real samples; finish tracking-only copy and mode-switch behavior.
4. **Phase 2 leftovers:** planned amounts from last month, missed-payment flags, recurring totals.
5. **Phase 3:** splash screen, widget, then morning/night brief notifications once templates are ready.
6. **Phase 4:** backup encryption.
7. **New import foundations:** currency-aware money model and shared source reconciliation; then multi-account Gmail and credit-card points tracking. Ship in increments, with SMS-only offline use preserved.
8. **Install route:** decide on Play internal testing vs USB/sideload.
9. **Phase 6:** "You skipped it" first, then morning reveal, personal records and the Sunday mini-Wrapped. All offline.
10. **Phase 5:** friends, starting with drip Score, streaks and the no-server share card.

**Decided:** UPI Lite top-ups → everyday expense (Other · UPI Lite) · no background refresh or per-transaction notifications · Bills and Investments separate, with tags · budget modes: set-aside (Planned or Actual, categories configurable) or tracking only · recurring only from mandate SMS or explicit marking · credit card bill payments are own transfers · no review inbox tab; quick-action cards instead.

**Still open:**
- Morning/night brief templates (you).
- Whether to pursue Google Play distribution.
- Whether the friends feature gets a backend (adds internet permission) or stays share-card only.

- First additional banks and card reward programs, based on available samples.
- Gmail authentication/sync architecture and first supported email formats.
- Initial currencies, FX-rate source and historical base-currency conversion policy.
