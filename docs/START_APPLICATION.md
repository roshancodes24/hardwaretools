# Start the application (Windows CMD & PowerShell)

Use this guide to run the Hardware Inventory System from **Command Prompt** or **PowerShell**.

| Mode | What runs | Browser URL |
|------|-----------|-------------|
| **Development** (day-to-day coding) | API on port **4000** + Vite UI on port **5173** | http://localhost:5173 |
| **Production** (single server) | API + built UI on one port | http://localhost:4000 |

---

## Prerequisites

1. **Node.js 20+** — check with `node -v`
2. **PostgreSQL** running locally (or a reachable remote instance)
3. Project folder open in a terminal at the **repository root**:
   - Example: `D:\Cursor Projects\Hardware Inventory System`

### Open a terminal at the project root

**Command Prompt (CMD)**

```bat
cd /d "D:\Cursor Projects\Hardware Inventory System"
```

**PowerShell**

```powershell
Set-Location "D:\Cursor Projects\Hardware Inventory System"
```

Replace the path if your clone lives elsewhere.

---

## First-time setup (once)

Run these from the project root in either CMD or PowerShell.

### 1. Install dependencies

```bat
npm install
npm install --prefix frontend
```

### 2. Create `.env`

**CMD**

```bat
copy .env.example .env
```

**PowerShell**

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set at least:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hardware_inventory
JWT_SECRET=dev-jwt-secret-change-in-production
NODE_ENV=development
```

Create the PostgreSQL database `hardware_inventory` if it does not exist yet (adjust user/password to match your install).

### 3. Generate Prisma client and apply migrations

```bat
npx prisma generate
npx prisma migrate deploy
```

### 4. Optional: seed demo users and sample data

```bat
npm run seed
```

After seeding you can sign in with:

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Admin |
| `cashier` | `cashier123` | Cashier |

Do **not** run seed against a live production database that already has real data.

---

## Development — start the app

You need the API and the web UI. Use **two terminals**, or start both with one command.

### Option A — one command (API + UI together)

From the project root:

```bat
npm run dev:all
```

Then open **http://localhost:5173**

Stop with `Ctrl+C`.

### Option B — two terminals (easier to read logs)

**Terminal 1 — API** (http://localhost:4000)

```bat
npm run dev
```

**Terminal 2 — Web UI** (http://localhost:5173)

```bat
npm run dev:web
```

Then open **http://localhost:5173**

The Vite dev server proxies `/api` to `http://127.0.0.1:4000`.

### PowerShell notes

Same `npm` commands work in PowerShell. If execution policy blocks scripts when using `npx`/`npm` wrappers, run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Only do this if PowerShell refuses to run npm scripts.

---

## Production — start the app (single URL)

Use this when you want one process serving API + built frontend on port **4000**.

### 1. Build the frontend

```bat
npm run build:release
```

### 2. Start

**CMD — npm**

```bat
npm run start:prod
```

**CMD — batch file**

```bat
scripts\start-production.bat
```

The batch file applies migrations, then starts the server. It expects `.env` and `frontend\dist` to exist.

**PowerShell — npm**

```powershell
npm run start:prod
```

**PowerShell — batch file**

```powershell
& ".\scripts\start-production.bat"
```

Then open **http://localhost:4000**

For production `.env`, set `NODE_ENV=production`, a strong `JWT_SECRET`, and usually `SERVE_FRONTEND=1`. See `packaging/GO-LIVE-NOTES.md` and `packaging/README.md`.

---

## Quick reference

| Goal | Command |
|------|---------|
| Install (root) | `npm install` |
| Install (frontend) | `npm install --prefix frontend` |
| Migrate DB | `npx prisma migrate deploy` |
| Seed demo data | `npm run seed` |
| Dev API only | `npm run dev` |
| Dev UI only | `npm run dev:web` |
| Dev API + UI | `npm run dev:all` |
| Build for production | `npm run build:release` |
| Run production | `npm run start:prod` |
| Health check | Browser or `curl http://localhost:4000/api/health` |

### Health check from the shell

**CMD**

```bat
curl http://localhost:4000/api/health
```

**PowerShell**

```powershell
Invoke-RestMethod http://localhost:4000/api/health
```

Expected shape: `{ "ok": true, ... }`

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| `DATABASE_URL` / Prisma connection errors | Confirm PostgreSQL is running and `.env` credentials match. |
| Port already in use | Stop the other process on 4000 or 5173, or set `PORT=...` in `.env`. |
| UI loads but API calls fail in dev | Ensure `npm run dev` is running; Vite proxies to `127.0.0.1:4000`. |
| `start-production.bat` says build first | Run `npm run build:release` (or `npm run build:frontend`). |
| Login fails after a fresh DB | Run `npm run seed`, or create users in the database. |
| Old API behavior after pulling code | Restart `npm run dev` / `start:prod` so the new routes load. |

More install and go-live detail: **`packaging/README.md`**, **`packaging/GO-LIVE-NOTES.md`**.
