# drip config backend

A Cloudflare Worker that serves drip's **remote config**: global settings you can change without an app release. It holds settings only, never anyone's data, and the app only ever downloads from it.

| Endpoint | Who | What |
|---|---|---|
| `GET /config.json` | the app (public) | The current config. No cookies, no identifiers; nothing about callers is stored. |
| `GET /admin` | you (password + signing key) | Editor for everything below, with history. Publishing signs the config in your browser with your key file. |

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

**Security:** apps only accept configs signed with a private key that stays on your Mac, never go back to older versions, and only allow links into this repo. A leaked password or a hacked Cloudflare account can't change any app. Full threat model: [SECURITY.md](SECURITY.md).

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

Then add the config URL to `android/local.json` as `"config_url": "https://drip-config.<your-subdomain>.workers.dev/config.json"` and rebuild the app (`python3 android/build.py`). The URL is baked into the APK; the WebView blocks every other outside address.

## Publishing

1. Open `https://drip-config.<your-subdomain>.workers.dev/admin` and sign in.
2. At the bottom, choose your **signing key** file: `~/.drip-private/config-signing-key.jwk` (created once with `node backend/scripts/keygen.mjs`; back it up offline). It's read in the browser tab only.
3. Edit, add a note, **Sign and publish**. To undo, load an older version from History and publish it again.

## Local development

Create `backend/.dev.vars` (git-ignored) with a throwaway local `ADMIN_PASSWORD=…` (20+ characters), then `npm run dev`. Delete it when done.
