# Remote config: security model

The config backend lets the owner change app settings without a release. It must never become a way to attack people who use the app.

## What the config can and can't do

**Can:** reorder, rename or hide tabs; change screen titles; add or switch off categorisation rules, merchant names, bank sender IDs and ignore phrases; adjust budget and insight thresholds; turn features off; show a banner or a "new version" notice.

**Can't, by design:**
- **Run code.** It's data, parsed field by field (`src/lib/remoteConfig.ts`); text is rendered as plain text, never as HTML.
- **Send anything anywhere.** The app only *downloads* one fixed URL baked into the APK; no field makes the app contact another address, and requests carry no identifiers or cookies.
- **Read your data.** Nothing from the phone is ever included in a request.
- **Link anywhere but the app's GitHub repo.** Banner and update links are checked against an allowlist built into the app (`ALLOWED_LINK_PREFIXES`), so no phishing page or fake APK, even in a signed config.
- **Weaken a lock you set.** Turning the app-lock feature off only hides its switch for people who haven't enabled it; an enabled lock keeps working and its switch stays visible.
- **Make a phone number a "bank".** Sender IDs must contain letters; personal SMS senders are also dropped on the device before the app sees them.

## Who can change it

| Threat | Result |
|---|---|
| Someone finds the config URL (it's in the APK) | They can read the settings. Nothing in it is secret. They can't change it. |
| Someone guesses / leaks the admin password | **Currently they can publish.** The backend signs on publish (the owner chose this for convenience; the key is the encrypted `SIGNING_KEY` Worker secret). What a config can do stays limited to the list above, so the worst case is wrong text or categories, never data theft, code or off-repo links. Ten wrong passwords lock the editor for 15 minutes per IP; the password is 20+ random characters. To restore the stronger mode (signing on the owner's Mac only), delete the `SIGNING_KEY` secret and bring back browser signing. |
| Cloudflare account compromised | They could publish (the signing key is a Worker secret). Protect the account with two-factor sign-in. |
| KV storage edited directly, or a fake server | Apps reject anything without a valid signature and keep their last good config. |
| Replaying an old (validly signed) config | Apps never go back to an older version number. |
| Man-in-the-middle / fake Wi-Fi | HTTPS only (plain HTTP is blocked on Android), and the signature check would fail anyway. |
| A malicious website using your logged-in admin session (CSRF) | Admin writes must come from the editor page itself (Origin check) and be JSON; the editor sends a strict Content-Security-Policy, can't be framed, and isn't indexed. |
| Oversized or malformed config | Refused before parsing (256 KB limit); every field is validated with limits; bad fields fall back to defaults. |
| Tampered copy cached on the phone | Re-verified on every start; rejected copies are ignored. |
| Web pages reaching the app's SMS / file bridges | The WebView only loads the app's own files; outside links open in the browser (https only), never inside the app. |

## What to protect

1. **`~/.drip-private/config-signing-key.jwk`** — the signing key. It lives outside the repo (git can't see it) and is blocked from commits. Keep a backup somewhere safe and offline (e.g. a password manager). If it leaks, run `node backend/scripts/keygen.mjs --rotate` and release an app with the new public key; if it's lost, do the same (old apps will keep their last config until updated).
2. **The admin password** — 20+ random characters, stored as the `ADMIN_PASSWORD` Worker secret, kept in your password manager.
3. **Your Cloudflare account** — turn on two-factor authentication.

## What's stored about callers

Nothing for the public `config.json` beyond one hourly counter per download. Usage events (`/e`) only increment hourly counters of fixed values; no request, IP, device or user ID is stored (see README → Anonymous usage). `/e` is unauthenticated, so anyone can inflate the counts: treat them as indicative, not exact. For the editor, the IP of a **failed** admin login is kept for 15 minutes (lockout) and then expires. Worker request logs ("observability") are off in `wrangler.toml`.
