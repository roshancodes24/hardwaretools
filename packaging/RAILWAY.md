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

One-off (Railway CLI or **one-off command** in the dashboard, if available):

```bash
npm run seed
```

Requires **`DATABASE_URL`** (and the same **`JWT_SECRET`** if seed touches auth—your `prisma/seed.ts` may vary). Use the same environment as production.

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
