# drip config backend

A Cloudflare Worker that serves drip's **remote config**: global settings you can change without an app release. It holds settings only, never anyone's data, and the app only ever downloads from it.

| Endpoint | Who | What |
|---|---|---|
| `GET /config.json` | the app (public) | The current config. No cookies, no identifiers; nothing about callers is stored. |
| `GET /admin` | you (password) | Editor for everything below, with publish, history and rollback. |

## What you can change

- **Bottom tabs:** order, names, show / hide (Today always shows).
- **Screen titles and subtitles:** Today, Briefing, Activity, Stats, Settings, Import.
- **Categorisation rules:** "contains → category / tag / kind", money in or out only, priority; switch built-in rules off.
- **Merchant names:** text contains → clean name.
- **Bank SMS senders:** add a bank by its sender ID (e.g. `YESBNK`).
- **Ignore phrases:** SMS containing them are never read as transactions.
- **Budget and insights:** late-salary day and amount, night-brief hour, insight thresholds.
- **Features:** switch balances, app lock, CSV import, insights, badges or haptics off for everyone.
- **Announcement banner** on Today, and a **new version notice** with a download link.

How it reaches phones: the app downloads the config when it opens and when it comes back to the foreground, checks every field (anything invalid falls back to the built-in default), and keeps the last good copy for offline use. A new config version re-reads the SMS inbox once, so changed rules apply to past transactions people haven't edited. Publishing runs the **same validation as the app**, so you can't publish something the app would ignore.

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

Put the printed `id` into `wrangler.toml` (`REPLACE_WITH_KV_ID`), then set the admin password (12+ characters; you'll sign in as user `admin`):

```bash
npx wrangler secret put ADMIN_PASSWORD
```

```bash
npx wrangler deploy
```

Then add the config URL to `android/local.json` as `"config_url": "https://drip-config.<your-subdomain>.workers.dev/config.json"` and rebuild the app (`python3 android/build.py`). The URL is baked into the APK; the WebView blocks every other outside address.

## Local development

`backend/.dev.vars` (git-ignored) holds a local `ADMIN_PASSWORD`; then `npm run dev`.
