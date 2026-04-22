# Deploy on Railway (Git + PostgreSQL + custom domain)

This app is one **Node** service: **Express API** plus the **built React UI** on the same port (`npm run start:prod`). Railway sets **`PORT`** automatically; the server reads it in `src/server.ts`.

Repo root includes **`railway.toml`**: build (frontend install + release build), **pre-deploy migrations**, start command, and **`/api/health`** for checks.

---

## What you need in Railway

1. A **Railway project** connected to your **Git** repo (GitHub/GitLab/Bitbucket).
2. A **PostgreSQL** database (Railway template).
3. **Variables** on the **web** service: `DATABASE_URL`, `JWT_SECRET`.
4. (Optional) **Seed** data after the first successful deploy.

---

## Step-by-step (first deploy)

### 1. Create the database

- In your Railway project, click **New** → **Database** → **PostgreSQL**.
- Wait until it finishes provisioning.

### 2. Create the web service from your repo

- **New** → **GitHub Repo** (or your provider) → pick **Hardware Inventory System** (or whatever the repo is named).
- Railway should detect **`railway.toml`** at the repo root and use its **build**, **pre-deploy**, and **start** commands.

### 3. Connect Postgres to the web service

- Open your **web** service → **Variables**.
- Click **Add variable** → **Add reference** (wording may vary).
- Choose the **PostgreSQL** service and its **`DATABASE_URL`** (or `POSTGRES_URL`, depending on template).  
  The important part: your running app must have an env var named **`DATABASE_URL`**, because Prisma and `src/lib/prisma.ts` expect that name.

If Railway only exposes `DATABASE_PUBLIC_URL` for external tools, the **internal** connection string reference is still usually exposed as **`DATABASE_URL`** to linked services—use whatever Railway shows for **linked** access.

**Seeding / CLI from your laptop:** `DATABASE_URL` often resolves to **`postgres.railway.internal`**, which **does not work** from your home PC (private Railway DNS). For `railway run npm run seed` from your machine you must also expose the **public** URL to that command:

1. **Postgres** service → enable **TCP Proxy** / public networking (Railway’s Postgres panel; required for `DATABASE_PUBLIC_URL`).
2. **Web** service → **Variables** → **Add** **`DATABASE_PUBLIC_URL`** → **Reference** → Postgres → **`DATABASE_PUBLIC_URL`** (exact name may match your template).
3. In the repo root, link the **web** service once (so `railway run` knows which service’s variables to use):  
   `railway service link <YourWebServiceName>`  
   (Use the exact name shown in the Railway project sidebar — **not** the Postgres service.)  
   If you skip this and have several services, you may see **“Multiple services found”** — then either run **`railway service link …`** or set **`RAILWAY_SERVICE`** to the web service name before seeding (see **`scripts\railway-seed.cmd`**).
4. Run **`scripts\railway-seed.cmd`** (recommended on Windows) or  
   `railway run powershell -NoProfile -ExecutionPolicy Bypass -File scripts\railway-seed-inner.ps1`  
   The helper sets **`DATABASE_URL`** from **`DATABASE_PUBLIC_URL`** for that run only.  
   Your **deployed** app still uses the internal **`DATABASE_URL`** reference for normal traffic.

### 4. Set `JWT_SECRET` (required for production login)

Production mode **requires** a non-empty secret (`src/lib/jwt.ts`).

- In the **web** service → **Variables** → **New variable**:
  - Name: `JWT_SECRET`
  - Value: a long random string (at least 32 characters).  
    Example (run on your own PC once):  
    `openssl rand -base64 48`  
    Or use a password manager’s random generator.

### 5. Deploy

- Trigger a deploy (push to the connected branch, or **Deploy** in the UI).
- **Build** installs `frontend` dependencies, builds the SPA, runs **`prisma generate`**.
- **Pre-deploy** runs **`prisma migrate deploy`** against `DATABASE_URL`.
- **Start** runs **`npm run start:prod`** (serves **`frontend/dist`** and **`/api/*`** on **`PORT`**).

### 6. Smoke test

- Open the service’s **Railway URL** (e.g. `https://something.up.railway.app`).
- You should see the **login** page (or the app shell), not only JSON at `/`.
- **`https://…/api/health`** should return JSON like `{ "ok": true, … }`.

### 7. Optional: seed demo users / data

Creates **`admin` / `admin123`** and **`cashier` / `cashier123`** (see `prisma/seed.ts`). **Wipes** existing transactional/catalog rows in that database—use on a fresh DB or only when you accept a reset.

**From your PC** (after `npm install -g @railway/cli`, `railway login`, and `railway link` in the repo root):

- Prefer **`scripts\railway-seed.cmd`** — it uses **`DATABASE_PUBLIC_URL`** when set (see **§3** above). Plain `railway run npm run seed` often fails with **P1001 / postgres.railway.internal** from a laptop.
- Or: `railway run powershell -NoProfile -ExecutionPolicy Bypass -File scripts\railway-seed-inner.ps1`

**Windows helpers** (same prerequisites):

- **CMD:** `scripts\railway-seed.cmd` (handles public DB URL for local seed).
- **PowerShell:** `.\scripts\railway-seed.ps1` — if execution policy blocks `.ps1`, use **`.cmd`** or:  
  `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

Requires **`DATABASE_URL`** on the web service for **deploys**; for **local seed**, also **`DATABASE_PUBLIC_URL`** on the web service (reference to Postgres) after TCP proxy is on. **`JWT_SECRET`** is not required for the seed itself, but you still need it on the web service to **log in** in the browser afterward.

---

## Custom domain

### Apex (root) domain — e.g. `example.com`

You said you are using the **apex** (no `www`, no `app.` prefix). Railway’s flow is the same in the dashboard, but **DNS at the root is stricter** than for a subdomain.

1. In the **web** service, open **Settings** → **Networking** / **Public networking** → **Custom domain**.
2. Add **`example.com`** (your real domain). Railway shows **two** records you must create:
   - A **CNAME** pointing the hostname Railway gives (often `@` or the bare domain) to a target like **`xxxx.up.railway.app`**.
   - A **TXT** record for verification. **Both are required.** If the TXT record is missing, you can see **404** on the custom domain even when the CNAME looks correct (see Railway’s [Working with domains](https://docs.railway.com/networking/domains/working-with-domains).)

3. **Why apex is special:** Normal DNS does not allow a plain **CNAME at the zone apex** next to other required records (like `NS` / `SOA`). Railway does **not** give you a fixed **A** record IP for “point `@` here”; it expects a **CNAME-style** target. So your **DNS host** must support one of:
   - **CNAME flattening** (e.g. **Cloudflare**: CNAME on `@` is flattened automatically), or  
   - **ALIAS** / **ANAME** (e.g. **DNSimple**) pointing `@` at the same `*.up.railway.app` hostname Railway shows.

   Many bare registrars (e.g. some Hostinger / GoDaddy / Reg.ru setups) **do not** support apex CNAME flattening. If adding the records Railway shows is impossible or stuck on “Waiting for DNS”, the usual fix is: move **only DNS** to a provider that supports apex CNAME/ALIAS (Cloudflare is the common free option), set the **nameservers** at your registrar to that provider, then add Railway’s **CNAME** (or ALIAS) + **TXT** there exactly as in the Railway UI.

4. **Domain bought on Railway:** If Railway (or a partner) holds the domain, still open the **DNS / nameservers** panel and confirm you can create **both** records Railway lists for the **root** name. If the product only allows simple **A** records at `@` and no flattening, you may need to point nameservers to DNS that supports Railway’s model, per above.

5. Wait for propagation (often **15–30 minutes**, sometimes longer). Railway issues **HTTPS** once verification succeeds.

**Optional:** Add a second custom domain **`www.example.com`** in Railway and a **CNAME** for `www` → the same Railway target, so both `https://example.com` and `https://www.example.com` work (or redirect one in your app later).

### Subdomain — e.g. `app.example.com`

Easier at most DNS hosts: a normal **CNAME** for `app` (no flattening needed) plus Railway’s **TXT** if shown.

---

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| Build fails on frontend | Logs for `npm install --prefix frontend` / `vite build`; ensure **Node ≥ 20** (`package.json` `engines`). |
| Pre-deploy / migrate fails | **`DATABASE_URL`** set and reachable from the **web** service (use **reference** to Postgres, not a broken copy-paste). |
| App starts but login fails | **`JWT_SECRET`** set on the **web** service; redeploy after adding it. |
| 404 on `/` but `/api/health` works | Build did not produce `frontend/dist`; check build logs. |
| CORS / wrong API host | Production UI calls **`/api/...`** on the **same** origin when `VITE_API_URL` is empty—correct for this setup. |
| Apex domain stuck “Waiting for DNS” / 404 on custom host | **TXT** verification record added? DNS provider supports **apex CNAME flattening** or **ALIAS**? See **Custom domain → Apex** above. |
| `railway run npm run seed` exits **1** / **P1001** / `postgres.railway.internal` | **`DATABASE_URL` is internal-only** — your PC cannot reach it. Enable Postgres **TCP proxy**, add **`DATABASE_PUBLIC_URL`** to the web service (reference Postgres), then run **`scripts\railway-seed.cmd`**. |
| **Multiple services found** | Run **`railway service link <WebServiceName>`** once in the repo root (the **web** app, not Postgres), or **`set RAILWAY_SERVICE=WebServiceName`** before **`scripts\railway-seed.cmd`**. |
| Other seed failures | Scroll for `❌ Seed failed`. Check **migrations applied**, **`npm install`** at repo root, **SSL** (`?sslmode=require` on public URL if required). |
| Seed **P2028** (transaction expired ~5000 ms) | Normal over a **public** DB URL; the seed uses a longer interactive transaction timeout. Pull latest `prisma/seed.ts` and run again. |

---

## After you change the database schema

Commit new files under **`prisma/migrations/`**. The next deploy’s **pre-deploy** step runs **`prisma migrate deploy`** and applies them.

---

## Pushing config from your PC

If `railway.toml` and this doc are new in your repo:

```bash
git add railway.toml packaging/RAILWAY.md package.json package-lock.json
git commit -m "Add Railway deploy config and guide"
git push
```

(Railway deploys from your **remote**; push the branch that the service tracks.)
