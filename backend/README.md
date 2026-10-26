# drip config backend

A Cloudflare Worker that serves drip's **remote config**: global settings you can change without an app release. It holds settings only, never anyone's data, and the app only ever downloads from it.

| Endpoint | Who | What |
|---|---|---|
| `GET /config.json` | the app (public) | The current config. No cookies, no identifiers; nothing about callers is stored. |
| `GET /admin` | you (password) | Editor: left tabs per section, each with its own Save (to a draft), global Reset (discard unpublished changes) and Publish, and full version history with what changed and one-click revert. |

## What you can change

- **Navigation:** five actions (Today, Manual log, Activity, Stats, Settings); Brief is merged into Today, with legacy IDs retained for compatibility, order, names, show / hide, and one highlighted primary action (Today always shows).
- **Screen titles and subtitles:** Today, Activity, Stats, Settings, Import. Legacy Briefing titles and night-brief settings remain in stored configs for older clients, but are hidden in the editor.
- **Categorisation rules:** "contains → category / tag / kind", money in or out only, priority; switch built-in rules off.
- **Merchant names:** text contains → clean name.
- **SMS parsing:** text a merchant name comes right after (money out, in or both) and extra words that end a name. Applies to new SMS. **Re-read stored SMS** (same section, off by default) applies parsing, names and/or rules to past SMS payments: choose the period (1–12 months), all automatic payments or only those with no merchant found, and optional SMS text; runs once per run number and never changes transactions people edited.
- **Bank SMS senders:** add a bank by its sender ID (e.g. `YESBNK`).
- **Ignore phrases:** SMS containing them are never read as transactions.
- **Budget and insights:** late-salary day and amount, insight thresholds.
- **Features:** switch balances, app lock, CSV import, insights, badges, haptics or anonymous usage stats (`analytics`) off for everyone.
- **App defaults:** set `defaults.lowercase` for people who have not chosen an appearance preference. Settings → App → Lowercase copy overrides the default; vendor names keep their original case in both modes. Requires version 0.8.14 or newer. The built-in default is off.
- **Analytics** (editor page, read-only): anonymous, aggregate usage: real-time active users, installs, daily / weekly / monthly users, sessions and time spent, screens, app versions, features in use, config downloads (traffic) and GitHub release downloads, over 24 hours to a year. See "Anonymous usage" below.
- **Announcement banner** on Today, and a **new version notice** with a download link.

How it reaches phones: the app downloads the config when it opens and when it comes back to the foreground, checks every field (anything invalid falls back to the built-in default), and keeps the last good copy for offline use. Config updates never reread the SMS inbox. Rules affect future imports by default. Each rule can explicitly opt into historical updates within twelve months; a history revision can request another pass. Jobs operate on stored transactions, never user edits or matching personal rules, and are not repeated for unrelated config updates. Personal rules always outrank global rules and are never removed by publishing. These controls require the updated client; older clients must be upgraded. Publishing runs the **same validation as the app**, so you can't publish something the app would ignore.

**Security:** apps only accept signed configs, never go back to older versions, and only allow links into this repo. The backend signs on publish (key in the `SIGNING_KEY` secret), so the admin password is what guards publishing. Full threat model: [SECURITY.md](SECURITY.md).

## Deploy (first time)

```bash
cd backend && npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler kv namespace create CONFIG
```

Put the printed `id` into `wrangler.toml` (`REPLACE_WITH_KV_ID`), then set the admin password (20+ random characters, keep it in your password manager; you'll sign in as user `admin`):

```bash
npx wrangler secret put ADMIN_PASSWORD
```

```bash
npx wrangler deploy
```

Usage counters (optional; without them the app's events are simply dropped):

```bash
npx wrangler d1 create drip-usage
```

Put the printed `database_id` into `wrangler.toml` (`[[d1_databases]]`), then create the tables:

```bash
npx wrangler d1 execute drip-usage --remote --file usage.sql
```

Then add the config URL to `android/local.json` as `"config_url": "https://drip-config.<your-subdomain>.workers.dev/config.json"` and rebuild the app (`python3 android/build.py`). The URL is baked into the APK; the WebView blocks every other outside address.

## Publishing

1. Open `https://drip-config.<your-subdomain>.workers.dev/admin` and sign in (user `admin`).
2. Pick a section on the left, edit, **Save**. Saved changes are a draft: not live yet, kept across reloads. Each section with unpublished changes shows a dot.
3. **Publish** (with a note) makes the draft live as the next version; **Reset** throws the draft away.
4. **Version history** lists every version with what changed. **Revert to this** publishes that version again as a new version.

The signing key (`~/.drip-private/config-signing-key.jwk`, made once with `node backend/scripts/keygen.mjs`) must also be stored as the Worker secret: `npx wrangler secret put SIGNING_KEY` with the file's contents.

## Local development

Create `backend/.dev.vars` (git-ignored) with a throwaway local `ADMIN_PASSWORD=…` (20+ characters), then `npm run dev`. Delete it when done.

## Anonymous usage

Apps POST fixed events to `/e` (list and validation: `src/lib/usageEvents.ts`): install, active day / week / month with the app version, session length, screen name, a once-a-minute ping while open, and feature flags. No IDs or free text exist in the format. The Worker adds them to hourly counters in D1 (`backend/usage.sql`) and keeps no request, IP or device data; per-minute live counters are pruned after two days and hourly counters after 400 days. People opt out in Settings → App; the `analytics` feature switches it off for everyone (the Worker then drops events too). Unique users are counted without IDs: each phone sends "active today / this week / this month" at most once per period.
