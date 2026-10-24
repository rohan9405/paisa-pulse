# Budget logic

Implemented in `src/lib/budget.ts`; tested in `tests/unit/budget.test.ts` and `tests/unit/moneyModel.test.ts`.

## Units and dates

- All money is **integer paise**. Parsing (`parseAmountToPaise`) works on strings, never floats.
- All dates are `YYYY-MM-DD` keys in the **Asia/Kolkata** calendar (`toISTKey`). A day ends at midnight IST regardless of the device timezone.

## Budget modes

Each budget plan (effective from a date) picks one:

- **Tracking only:** no budget inputs, set-aside calculation, allowance, balance or deficit. Spending is categorised and charted; income transactions are still imported and reported. Tagging and automatic payee rules work in every mode.
- **Set-aside budget** (`budgetMode: "set-aside"`): the categories in `plan.setAside` (default Bills, Investments, Savings) come off income before the daily budget. Everything else is everyday spending. Two ways to set aside (`plan.setAsideMode`):
  - **planned** (default): you enter monthly income and expected amounts as planned lines (`Commitment`: Bills / Investments / Savings, with a tag).
  - **actual**: no income or planned-payment amount inputs. Recorded income transactions fund the pool; tagged set-aside payments reduce it as they arrive. Transfers and refunds are not income. Before income arrives, allocation is zero. Older plans without `budgetMode` retain their inferred tracking/budget selection; new plans store the explicit selection.

Categories: **Bills** (tags Rent, Utility, Phone & internet, EMI, Insurance, Maintenance), **Investments** (SIP, Stocks, Mutual fund, NPS / PPF, RD / FD, Emergency fund). Savings is no longer offered for new selections. Existing Savings records and rules remain intact, count under Investments in Stats, and preserve their original plan semantics. Investments and legacy Savings are never expenses.

## Monthly pool (planned)

```
pool = take-home income − Σ planned lines in set-aside categories
```

- Planned lines already paid this month are still deducted. Ticking "paid this month" (or a matching payment) only marks them paid so they aren't shown as upcoming.
- If planned lines exceed income, `pool < 0`: the allocatable pool is clamped to ₹0, the shortfall is shown, and any spending becomes a deficit. Nothing crashes.

### Matching payments to planned lines

A payment in a set-aside category is matched to a planned line in the same category: the one you linked, else the best unique match by UPI ID / text hint (3 points), tag (2), name (2) and amount within 15% (1), needing at least 2 points.

- **Paid more** than planned (cumulative for the month): the excess counts as spending that day.
- **Paid less**: the difference is credited (`adjustPaise`) on the last day of the month, once split payments can no longer arrive.
- **No planned line**: the full amount counts as spending that day.

## Actual set-aside

For each day `d` of month `M` (only tracked days count):

```
income_M  = sum(recorded income in M since the current budget period began, through d)
remaining = income_M − Σ set-aside payments in M through d − Σ allocations earlier in M + Σ deficit already charged in M
allocation(d) = remaining / days left in M (floored; the last day takes the rest)
```

A payment on day `d` lowers `d`'s allocation and every later one. If `remaining < 0` (payments beyond what's left), the allocation is ₹0 and the overshoot is charged once as a deficit that day. Allocations plus shortfall adjustments add up exactly to recorded income minus set-aside payments. Received income is never prorated or forecast; refreshing imports or correcting an income/transfer tag recalculates the ledger. An imported income dated before tracking or before a budget activation after tracking does not fund that budget.

## Daily allocation and rounding

```
n = calendar days in that month (28/29/30/31)
base = floor(pool / n),  r = pool − base × n     (0 ≤ r < n)
allocation(day d) = base + (d ≤ r ? 1 : 0)
```

The leftover paise go one each to the first `r` days, so the days of a month always sum to the pool exactly. Each month uses its own day count (Feb 2024 → 29, Feb 2026 → 28). Planned mode never divides by "days remaining"; only actual mode does, on purpose, so a payment reshapes the rest of the month.

## Accrual

```
available(today) = Σ allocation(tracking start … today)
                 + opening adjustment
                 − Σ everyday spending(tracking start … today)
                 + Σ adjustments (planned lines under plan, actual-mode overshoot)
```

- Unspent money carries forward; overspending produces a negative balance (deficit), never extra money.
- **Mid-month start:** accrual begins on the chosen tracking date. Earlier days are not credited and earlier spending is ignored. The opening adjustment is explicit and defaults to ₹0.
- Future-dated transactions don't count until their date.
- **Mode changes:** tracking days retain spending for reports but have zero carried/closing budget balance. Starting a budget after tracking begins at zero on its effective date; prior tracking spending, income, set-asides and any old opening adjustment do not carry into it. Earlier budget days retain their historical balances. Actual mode also ignores the manual opening adjustment.
- **Budget changes** create a new plan with an `effectiveFrom` date. Each day uses the plan in force on that day, so history isn't rewritten.

## What counts against the daily budget

| Payment | Daily budget | Stats |
|---|---|---|
| Outflow in a category that isn't set aside | yes, net of linked refunds | its category |
| Set-aside category, planned mode, matched | only the excess over the planned line | Bills / Investments / Savings |
| Set-aside category, planned mode, no planned line | yes, in full | Bills / Investments / Savings |
| Set-aside category, actual mode | no: it shrinks the month's pool | Bills / Investments / Savings |
| Set-aside category, tracking only | no | Bills / Investments / Savings |
| `transfer` (own accounts, credit card bill payments) | no | excluded |
| `refund` linked to a payment | reduces that payment, on its date, capped at its amount | — |
| `refund` unlinked | no effect; flagged for review | — |
| `income` (tags Salary, Dividend income, Interest) | no | money in |

- UPI, card, cash, etc. are **payment methods**, not categories.
- A refund of an expense dated before tracking began doesn't credit the budget.
- Deleting an expense un-links its refunds and flags them for review.

## Matching

- **Refunds** (`autoLinkRefund`): same merchant, on/before the refund, within 120 days, enough un-refunded amount left. Exactly one exact-amount candidate ⇒ auto-link; otherwise flagged for review.
- **Planned lines** (`matchCommitment`): automatic, see above. Activity only suggests a match for payments that aren't matched already.
- **Rules**: a rule for the payee's UPI ID beats text rules; both set a category and optionally a tag. Saving "Always use this" on a transaction applies the rule to your past payments to that payee too.
- **Recurring payments** come from autopay / e-mandate SMS (created, changed, cancelled) or a transaction marked "Repeats every month". The next due date skips a cycle once a payment to the same payee (or name) arrives within 10 days before to 5 days after it.
- **Transfers** (`transferPairs`): equal-amount money out and money in within 2 days ⇒ suggested own-account transfer. Rules (e.g. "self transfer", or a user rule for "sbi xx1234") mark transfers on import.

## CSV deduplication

`fingerprint = ref:<bank reference>` when a reference column is mapped, otherwise `date | direction | amount | normalised description`. Rows matching existing data are skipped by default (the user can override). Identical rows *within one file* with no reference stay included but flagged, because two identical ₹20 chais on one day are real.

## Stats position and category navigation

- Net In-Hand = income − net expenses − investments. Every income bucket counts, excluding refunds and settlements. Own-account transfers are excluded.
- Refunds and settlements share the indexed `refundOf` link. They reduce the original payment as of the report cutoff; they do not become income. Multiple shares are capped at the original payment’s remaining amount, including concurrent writes. Unlinked settlements require review.
- The daily spending dotted line averages the selected month’s tracked calendar days through the selected period end (through today for current periods), including zero days. Tracking mode uses net expense spending; budget periods retain their budget-spend definition.
- Stats category rows deep-link to `/transactions?month=YYYY-MM&category=...`. Activity validates the parameters and exposes the month/category as editable controls. Historical months remain selected; a week spanning months uses its ending month for the drill-down.

## Budget-mode availability and historical comparison

`budget.setAsideModes` is a validated nonempty subset of Planned/Actual (default both). It controls new budget/editor choices only, without migrating existing plans. A single enabled mode has explanatory copy and its relevant inputs, without selection chips. Saving an edited budget explicitly creates a new plan version.

The Stats grey dotted curve uses last month’s cumulative spending on the matching day number. A shorter preceding month holds its final value; tracking that began partway through that prior month produces no comparison rather than a misleading zero.

Recurring IPO authorizations (`purpose: ipo`, or a matching confirmed hold reference without an explicit override) are excluded from upcoming reminders and recurring totals. Explicit `purpose: payment` wins over reference inference. Classification never creates a financial transaction or fund-hold event.
