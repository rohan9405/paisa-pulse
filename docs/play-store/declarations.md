# Submission answers and review notes

Prepared against the app's current code on 24 October 2026. These are evidence-based drafts, not submitted declarations. The account owner must confirm the actual service configuration and final answers in Console.

## SMS permissions declaration

**Use case:** SMS-based money management (budgeting and expense tracking).

**Requested permissions:** READ_SMS and RECEIVE_SMS. No SEND_SMS, WRITE_SMS or call-log permissions.

**Core functionality statement:**

drip automatically converts supported Indian bank transaction SMS into an on-device expense ledger and daily budget. READ_SMS imports alerts from the tracking start date and catches missed alerts. RECEIVE_SMS lets an installed home-screen widget schedule a short on-device import and refresh when a supported bank alert arrives, including while the app is closed. The app does not send messages or upload SMS or financial records. SMS access is optional and follows an in-app disclosure and affirmative agreement before the Android permission prompt. Phone-number senders are filtered before messages reach the JavaScript parser; OTPs, offers and unrelated messages are ignored by the parser.

**Reviewer steps / recording script:**

1. Fresh installation → welcome screen: no Android SMS prompt appears.
2. Explore demo: fictional data, no SMS access or account login.
3. Switch → Set up my budget → finish budget setup.
4. Tap Set up SMS import. Record the full native explanation, including background widget use, optional access, and on-device processing.
5. Tap Not now: budget and manual expense entry remain available.
6. Tap Set up SMS import again → Agree and continue → Android permission prompt. Demonstrate permission denial, then grant through the normal flow/settings if Android has stopped prompting.
7. Use a test phone/emulator with fictional bank-alert SMS only. Show a supported bank transaction becoming an expense and demonstrate no duplicate on re-sync.
8. Install a home-screen widget and demonstrate refresh with a new fictional alert; explain Android scheduling delays.
9. Revoke SMS permission in Android Settings and demonstrate no new import. Existing transactions remain until deleted.
10. Show Settings → Data → Delete data and the public privacy policy link.

A native screen recording is still required if requested by Google. Do not use real inbox data in it. SMS approval is Google's decision; ordinary runtime permission alone is not Play policy approval.

## Data safety draft

| Area | Current evidence / answer guidance |
| --- | --- |
| SMS and financial data | Accessed and processed locally, including original text for accepted bank transactions. Not uploaded to the developer. Google's Data safety guidance excludes exclusively on-device processing from “collection.” |
| Config download | HTTPS GET to Cloudflare; no SMS, transaction payload, cookies, account IDs or advertising IDs. The hosting provider sees connection information such as IP/time. `backend/wrangler.toml` disables Worker observability and the public-config handler does not retain caller IPs (failed admin logins are separate). Confirm the deployed provider logging/retention, geolocation and analytics settings before finalizing the form; don't blindly claim “no data collected.” If connection information is retained or used for an in-scope purpose, declare the applicable type/purpose. |
| Backups | User-selected folder via Android document picker; JSON backup is unencrypted and contains financial records/source text. Folder may sync through another provider. Review Google's user-directed transfer rules against the chosen implementation. |
| Anonymous usage stats | On by default, opt-out in Settings → App; global switch in config Features. HTTPS POST to the same Worker (`/e`) of fixed events only: install, active day/week/month + app version, session length, screen name, once-a-minute ping, feature flags (mode, SMS on/off, app lock, demo). No device/advertising/account IDs, no SMS or financial data; the Worker stores hourly totals in D1 (no request log, no IP), kept up to 400 days. Declare **App activity → App interactions** (and possibly **App info and performance**) as *collected*, *not shared*, purpose **Analytics**, processed **ephemerally: no**, **optional (user can opt out)**. Data is not linked to identity. |
| Ads / AI | No advertising or third-party analytics SDKs and no external AI calls in this app. |
| Encryption in transit | The app's one remote endpoint is HTTPS; cleartext traffic is disabled. This is not a claim that the local database or backup files are encrypted by drip. |
| Accounts / deletion | No drip account creation. Local deletion is in Settings → Data; users delete exported/cloud copies separately. Account-deletion URL generally does not apply without accounts. |
| Support | User-initiated email/GitHub reports leave the app; policy explains that public issues can be visible. Don't attach real SMS or backups to public reports. |

## Other App content forms

- Ads: **No**.
- App access: all features available without login; provide demo instructions above.
- Financial features: disclose the budgeting/expense-management functionality under the applicable “Other” financial support category if Console offers it. Do not claim no financial features. No lending, payments, trading, investment execution or insurance.
- Target audience: recommend adults (18+) for the initial launch; owner must confirm the intended audience. App content rating must be answered from the actual app, not fabricated.
- News, government, health, VPN: none of these services are provided.
- No broad storage permission: backup/import uses Android's file/folder picker.

## Account type needs confirmation

The account currently shown by the user is Personal. Google's Play Console requirements require Organization registration for financial products/services, and its financial-services definition includes management of money. Budgeting-only apps are not explicitly excluded in the policy. Confirm drip's eligibility with Play Developer Support before production submission/payment changes; the app's on-device nature does not establish an exemption. Do not misrepresent the app's financial features or create an organization without a verifiable business.

Suggested support question:

> I have a Personal developer account under the developer name Soft Orbit Apps. My app, drip, is an offline/on-device budgeting and expense tracker. It parses bank transaction SMS with permission and calculates a daily allowance, but provides no banking, lending, payments, trading, investment execution, or personalised financial advice. May this app be published from a Personal account, or must I convert to a verified Organization account under the financial-services requirement?

## Official references

- Account requirements: https://support.google.com/googleplay/android-developer/answer/10788890?hl=en
- Financial services: https://support.google.com/googleplay/android-developer/answer/9876821?hl=en-IN
- SMS exception: https://support.google.com/googleplay/android-developer/answer/10208820?hl=en
- User data and disclosures: https://support.google.com/googleplay/android-developer/answer/10144311?hl=en
- Data safety: https://support.google.com/googleplay/android-developer/answer/10787469?hl=en
- Financial declaration: https://support.google.com/googleplay/android-developer/answer/13849271?hl=en
