import type { ProviderDescriptor } from "./types";

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: "demo",
    name: "Demo data",
    kind: "demo",
    description: "Fictional Indian transactions generated on this device. Not real bank data.",
    automatic: false,
    available: true,
  },
  {
    id: "manual",
    name: "Manual entry",
    kind: "manual",
    description: "Expenses you add yourself with quick-add.",
    automatic: false,
    available: true,
  },
  {
    id: "csv",
    name: "CSV statement import",
    kind: "file",
    description: "Upload a statement exported from your bank or card. Parsed entirely in this browser.",
    automatic: false,
    available: true,
  },
  {
    id: "sms",
    name: "Bank SMS",
    kind: "sms",
    description: "Reads HDFC, ICICI, SBI, Axis and Kotak transaction alerts from your SMS inbox, on this phone. Android app only.",
    automatic: true,
    available: true,
  },
  {
    id: "account-aggregator",
    name: "Bank sync (Account Aggregator)",
    kind: "aggregator",
    description:
      "Automatic, consent-based bank sync through an RBI-licensed Account Aggregator. Not built yet — needs a backend and a regulated partner.",
    automatic: true,
    available: false,
  },
];

export function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}
