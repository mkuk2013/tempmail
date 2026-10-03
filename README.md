# TempMail — your own temporary email service

TempMail is a small, free-to-run temporary email app that lives entirely on
**Cloudflare**:

- **Email Routing** receives mail for *any* address at your domain
  (a catch-all rule), so `anything@yourdomain.com` just works.
- A **Cloudflare Worker** parses each incoming email and stores it in a
  **D1** database, and also serves the web app.
- The **PWA frontend** lets you create random or custom addresses, keep a
  list of saved addresses (each with its own inbox), and read mail the
  moment it arrives. Messages delete themselves after 7 days by default.

It is **receive-only** — sending email needs a separate SMTP service and is
not part of this app.

---

## What you need

- A free **Cloudflare account**
- A **domain name** (registered anywhere) that you can point at Cloudflare
- **Node.js** installed on your computer (for the `wrangler` tool)

## Step-by-step setup

### 1. Add your domain to Cloudflare

1. Sign up at <https://cloudflare.com> (free plan is fine).
2. Click **Add a domain**, enter your domain, choose the free plan.
3. Cloudflare shows you **two nameservers**. Go to your domain registrar
   (where you bought the domain) and replace its nameservers with those two.
4. Wait until Cloudflare says the domain is **Active** (usually minutes,
   sometimes a few hours).

### 2. Install the project

```bash
cd temp-mail-app
npm install
```

### 3. Log in with Wrangler

```bash
npx wrangler login
```

This opens your browser — approve the login.

### 4. Create the database

```bash
npx wrangler d1 create tempmail
```

It prints a `database_id`. Copy it into **wrangler.toml**:

- Paste it as the `database_id` value (replacing `PASTE_YOUR_DATABASE_ID_HERE`).
- Also set `MAIL_DOMAIN` in the same file to your real domain,
  e.g. `MAIL_DOMAIN = "example.com"`.

### 5. Create the tables

```bash
npm run db:init
```

### 6. Deploy

```bash
npm run deploy
```

Wrangler prints your Worker URL, something like
`https://tempmail.<your-subdomain>.workers.dev`.

### 7. Turn on Email Routing (the important part)

1. In the Cloudflare dashboard, open **your domain** → **Email** →
   **Email Routing** and enable it (Cloudflare adds the needed MX/DNS
   records for you).
2. Go to **Email Routing → Routing rules** → create the **Catch-all**
   rule (or edit the existing catch-all):
   - **Action:** *Send to a Worker*
   - **Destination:** choose the **tempmail** Worker
3. Save. Now every address `@yourdomain.com` delivers to TempMail.

### 8. Test it

1. From any mailbox (Gmail, your phone, anything), send an email to a
   made-up address, e.g. `hello123@yourdomain.com`.
2. Open your Worker URL, create that same address (`hello123`) in the app —
   or just tap **Random** and send mail to the address shown.
3. The email appears in the inbox within a few seconds. The inbox also
   auto-refreshes every 15 seconds.

### 9. Install the app on your phone

Open the Worker URL in your phone browser → browser menu →
**Add to Home screen / Install app**. TempMail now works like a normal app.
(Later, if you want, you can attach your own domain/subdomain to the Worker
under **Workers & Pages → tempmail → Settings → Domains & Routes**.)

---

## Name guarantee

Every name you create — Random or Custom — is recorded on the server in a
permanent `used_names` list. That gives you two guarantees:

- **Random never repeats.** The Random button asks the server for a name,
  and the server only hands out a local part that has never been used
  before (and has never received mail). No name is ever generated twice.
- **A deleted name is gone forever.** When you remove an address, the
  server *retires* its name: all of that address's stored mail is deleted
  with it, and the name can never come back — Random will never generate
  it, and trying to create it manually is refused with the message
  *"This name was deleted before and cannot be created again."*

Deleting one address never affects your other addresses.

## Good to know

- **Privacy warning:** by default there is *no password*. Anyone who knows
  or guesses an address can read that inbox in this app. Addresses are the
  only secret — treat them like passwords, and prefer long random ones.
- **Optional app password (recommended):** lock the whole app with one
  password:
  ```bash
  npx wrangler secret put APP_PASSWORD
  npm run deploy   # not strictly needed, secret applies on next deploy automatically
  ```
  The app will ask for this password once and remember it on that device.
- **Retention:** messages older than `RETENTION_DAYS` (wrangler.toml,
  default `7`) are deleted — automatically when mail arrives, plus a daily
  cleanup at 03:00 UTC. Change the number and re-deploy to keep mail longer
  or shorter.
- **Costs:** everything here fits Cloudflare's free tiers for personal use
  (Workers, D1 and Email Routing all have generous free allowances).
- **Multiple addresses:** create as many as you like — random or custom.
  Each saved address has its own inbox; the server simply filters received
  mail by recipient, so addresses cost nothing and need no setup.
- **Limits:** the inbox shows the latest 100 messages per address.

## Project layout

```
src/worker.js          Worker: email() receiver + /api/* + static assets
public/                PWA frontend (no build step)
  index.html  css/  js/  manifest.webmanifest  sw.js  icons/
schema.sql             D1 tables for stored messages and used names
wrangler.toml          Worker, D1, vars and cron configuration
```
