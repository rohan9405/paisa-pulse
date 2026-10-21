# Automatic data import: what production would need

Today the app supports demo data, manual entry, CSV import and, in the Android app, automatic bank SMS parsing on the device (see the README). Automatic import is the long-term goal. This note describes what a **legitimate** integration requires. It doesn't describe or invent any provider's API.

## What exists in the code

`src/data/providers/types.ts` defines a `TransactionProvider`:

- `id`, `name`, `kind` (`demo | manual | file | aggregator`), `automatic`, `available`
- optional `sync({ since, cursor })` returning normalised transactions plus a cursor
- connection state is stored per provider in the `connections` table: `status` (`connected | disconnected | syncing | error | not_available`), `lastSyncAt`, `lastError`, `lastCount`
- every transaction carries **provenance** in `Transaction.source`: `providerId`, `importBatchId`, `externalRef`, `raw`, `importedAt`

The registry (`src/data/providers/registry.ts`) lists an "Account Aggregator" entry marked unavailable. Nothing calls a real network service.

## The legitimate route in India: Account Aggregator (AA)

India's AA framework (RBI's NBFC-AA Master Directions) lets users share bank data through **consent**, not credentials:

- The user approves a time-bound **consent** in an AA app. It covers which accounts, which data, the purpose, frequency and retention.
- Data flows from the bank (a **Financial Information Provider, FIP**) via the AA to the app (a **Financial Information User, FIU**). Data is encrypted end-to-end; the AA can't read it.
- The user can revoke consent at any time.
- No bank passwords, PINs or OTPs are ever given to the app.

### What we'd need before building it

1. **A regulated entity to act as FIU.** To receive data, an FIU must be regulated by a financial-sector regulator (RBI, SEBI, IRDAI or PFRDA). A budgeting app usually partners with a regulated entity, or works through a licensed technology service provider that operates under one. This is a legal and business step, not a code change.
2. **Onboarding with one or more AAs** (and Sahamati, the industry body, for the ecosystem), plus certification against the ReBIT technical specifications that AAs and FIUs implement.
3. **A backend.** Consent requests, key exchange, data decryption, webhooks/notifications, and storing consent handles can't run safely in the browser. That means:
   - an authenticated user account (today the app has none, on purpose)
   - server-side key management and encryption at rest
   - a sync worker that maps FI data → `ProviderTransaction`, sets `externalRef` from the bank's transaction id, and reuses the existing fingerprint/dedupe and categorisation pipeline
   - audit logging of consent creation, use and revocation
4. **Privacy and compliance:** purpose limitation and data minimisation (only deposit/transaction data the feature needs), retention that matches the consent, deletion on revocation, a privacy policy, and compliance with the **Digital Personal Data Protection Act, 2023**. This changes the current "data never leaves the browser" promise, so it would need an explicit opt-in and clear disclosure.
5. **Coverage gaps:** not every bank is live as an FIP, and credit cards, wallets and UPI apps may not be available through AA. CSV import stays as a fallback.

### Explicitly out of bounds

- Screen-scraping net banking, or asking for bank passwords, PINs, OTPs or card details.
- Reading SMS/email for transactions without clear consent and platform permission. The Android app reads SMS only after the user grants `READ_SMS`, only on the device, and is sideloaded (Play restricts SMS permissions to default SMS apps).
- Calling any provider endpoint from the browser with embedded secrets.

## Other sources we could add without new regulation

- More CSV/Excel templates per bank (the mapper already handles arbitrary columns).
- PDF statement parsing done locally in the browser, with the same preview/validate/dedupe flow.
- OFX/QIF import.
