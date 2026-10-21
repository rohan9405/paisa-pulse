# Budget logic

Implemented in `src/lib/budget.ts`; tested in `tests/unit/budget.test.ts`.

## Units and dates

- All money is **integer paise**. Parsing (`parseAmountToPaise`) works on strings, never floats.
- All dates are `YYYY-MM-DD` keys in the **Asia/Kolkata** calendar (`toISTKey`). A day ends at midnight IST regardless of the device timezone.

## Monthly pool

```
pool = take-home income − Σ fixed bills − Σ savings/investment targets
```

- Commitments already paid this month are still deducted. Ticking "paid this month" (or matching a transaction) only marks them paid so they aren't shown as upcoming.
- If commitments exceed income, `pool < 0`: the allocatable pool is clamped to ₹0, the shortfall is shown, and any spending becomes a deficit. Nothing crashes.
- No income ⇒ **tracking-only mode**: no allowance, spending is still categorised and charted.

## Daily allocation and rounding

```
n = calendar days in that month (28/29/30/31)
base = floor(pool / n),  r = pool − base × n     (0 ≤ r < n)
allocation(day d) = base + (d ≤ r ? 1 : 0)
```

The leftover paise go one each to the first `r` days, so the days of a month always sum to the pool exactly. Each month uses its own day count (Feb 2024 → 29, Feb 2026 → 28). We never divide by "days remaining".

## Accrual

```
available(today) = Σ allocation(tracking start … today)
                 + opening adjustment
                 − Σ discretionary spending(tracking start … today)
```

- Unspent money carries forward; overspending produces a negative balance (deficit), never extra money.
- **Mid-month start:** accrual begins on the chosen tracking date. Earlier days are not credited and earlier spending is ignored. The opening adjustment is explicit and defaults to ₹0.
- Future-dated transactions don't count until their date.
- **Budget changes** create a new plan with an `effectiveFrom` date. Each day uses the plan in force on that day, so history isn't rewritten.

## What counts as discretionary spending

| Kind | Daily budget | Total outgoings |
|---|---|---|
| `expense` | yes, net of linked refunds | yes |
| `commitment` (matched to a bill/savings reservation) | only the part above the reserved amount for that month | yes, counted once |
| `commitment` whose reservation no longer exists | yes | yes |
| `investment` (outside savings targets) | no | yes, shown separately |
| `transfer` (own accounts) | no | no (shown as excluded) |
| `refund` linked to an expense | reduces that expense, on the expense's date, capped at its amount | — |
| `refund` unlinked | no effect; flagged for review | — |
| `income` | no | no |

- UPI, card, cash, etc. are **payment methods**, not categories.
- A refund of an expense dated before tracking began doesn't credit the budget.
- Deleting an expense un-links its refunds and flags them for review.

## Matching

- **Refunds** (`autoLinkRefund`): same merchant, on/before the refund, within 120 days, enough un-refunded amount left. Exactly one exact-amount candidate ⇒ auto-link; otherwise flagged for review.
- **Bills/savings** (`commitmentCandidates`): match hint or name in the narration, and/or amount within 10%. Suggestions only; the user confirms.
- **Transfers** (`transferPairs`): equal-amount money out and money in within 2 days ⇒ suggested own-account transfer. Rules (e.g. "self transfer", or a user rule for "sbi xx1234") mark transfers on import.

## CSV deduplication

`fingerprint = ref:<bank reference>` when a reference column is mapped, otherwise `date | direction | amount | normalised description`. Rows matching existing data are skipped by default (the user can override). Identical rows *within one file* with no reference stay included but flagged, because two identical ₹20 chais on one day are real.
