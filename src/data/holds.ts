import type { FinanceDB } from "./db";
import { uid } from "./db";
import { summarizeHold, type IpoEvent } from "@/lib/ipo";
import type { FundHold } from "@/lib/types";

export async function applyIpoEvent(db: FinanceDB, event: IpoEvent): Promise<string> {
  const candidates = event.reference ? await db.holds.where("reference").equals(event.reference).toArray() : [];
  const matches = candidates.filter((h) => h.bank === event.bank && (!h.account || !event.account || h.account === event.account));
  const existing = matches.length === 1 ? matches[0] : !event.reference ? await db.holds.filter((h) => h.bank === event.bank && (!h.account || !event.account || h.account === event.account) && h.events.some((e) => e.id === event.id)).first() : undefined;
  if (existing?.events.some((e) => e.id === event.id)) return existing.id;
  const events = [...(existing?.events ?? []), { id: event.id, type: event.type, amountPaise: event.amountPaise, at: event.at, raw: event.raw }];
  const hold: FundHold = {
    id: existing?.id ?? uid("hold-"), name: event.name !== "IPO application" ? event.name : existing?.name ?? event.name,
    bank: event.bank, account: event.account ?? existing?.account, reference: event.reference,
    events, ...summarizeHold({ events, reference: event.reference }),
    createdAt: existing?.createdAt ?? event.at, updatedAt: Date.now(),
  };
  if (matches.length > 1 || event.ambiguous) { hold.needsReview = true; hold.status = "needs_review"; }
  await db.holds.put(hold);
  // IPO mandates are not recurring. Remove only automatically created entries
  // proven by this reference (never a user's own recurring entry).
  if (event.reference) await db.recurring.filter((r) => r.source === "mandate" && !r.userEdited && r.mandateRef?.toLowerCase() === event.reference).delete();
  return hold.id;
}
