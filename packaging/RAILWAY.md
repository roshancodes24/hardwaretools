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

## Custom domain (purchased on Railway)

1. In the **web** service, open **Settings** → **Networking** / **Domains** (UI labels change over time).
2. **Add custom domain** → enter your domain (e.g. `app.yourbusiness.com` or `yourbusiness.com`).
3. Railway shows **DNS records** to add (often a **CNAME** to a `*.up.railway.app` target, or **A/ALIAS** for apex domains).
4. At your **DNS host** (where the domain’s nameservers point—sometimes Railway DNS, sometimes Cloudflare, GoDaddy, etc.), add exactly the records Railway lists.
5. Wait for DNS (often minutes, sometimes up to 48 hours). Railway will show **SSL** as active when ready.

**Tip:** Use a **subdomain** (`inventory.yourdomain.com`) first; apex (`yourdomain.com`) DNS can be trickier depending on the provider.

---

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| Build fails on frontend | Logs for `npm install --prefix frontend` / `vite build`; ensure **Node ≥ 20** (`package.json` `engines`). |
| Pre-deploy / migrate fails | **`DATABASE_URL`** set and reachable from the **web** service (use **reference** to Postgres, not a broken copy-paste). |
| App starts but login fails | **`JWT_SECRET`** set on the **web** service; redeploy after adding it. |
| 404 on `/` but `/api/health` works | Build did not produce `frontend/dist`; check build logs. |
| CORS / wrong API host | Production UI calls **`/api/...`** on the **same** origin when `VITE_API_URL` is empty—correct for this setup. |

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
