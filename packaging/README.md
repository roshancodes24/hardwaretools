# Installing this app on another computer

This project is a **Node.js server** (Express + Prisma) plus a **React** front end, and it uses **PostgreSQL**. There is **no supported single `.exe`** that bundles the database, Node runtime, and native Prisma engines in one click—that would be a large custom desktop product (for example Electron + an embedded database) and is not what this repository ships.

## Practical options

### A. One folder + Node + PostgreSQL (recommended)

1. On a build machine (or this PC), from the repo root:
   - `npm ci --omit=dev`
   - `npm run build:release` (builds `frontend/dist` and runs `prisma generate`)
2. Copy the whole project folder to the target PC (or zip it **without** `node_modules` and run `npm ci --omit=dev` there).
3. On the target PC install **Node.js 20+** and **PostgreSQL**.
4. Create a **`.env`** file in the project root with at least:
   - `DATABASE_URL=postgresql://...`
   - `JWT_SECRET=` a long random string (required in production)
5. Run migrations: `npx prisma migrate deploy`
6. Seed users (optional): `npm run seed`
7. Start the combined server:
   - **Windows:** double‑click `scripts\start-production.bat`, or run `npm run start:prod`
   - Open a browser at **http://localhost:4000** (API + static UI on the same port).

### B. Docker (good for identical installs)

Use Docker Compose to run PostgreSQL + this app (you would add a `Dockerfile` / compose file—out of scope here unless you want it added to the repo).

### C. “Looks like an .exe”

You can turn **`scripts\start-production.bat`** into a **shortcut** or use a third‑party **BAT-to-EXE** tool so staff double‑clicks an icon. That still requires **Node** and **PostgreSQL** installed on the machine (or a shared database URL).

## Scripts reference

| Command | Purpose |
|--------|---------|
| `npm run build:release` | Production web build + `prisma generate` |
| `npm run start:prod` | Serves **API + `frontend/dist`** on `PORT` (default 4000) |
| `SERVE_FRONTEND=1` | Forces SPA hosting even if `NODE_ENV` is not `production` |

Optional: set **`FRONTEND_DIST`** to an absolute path if the built files are not at `frontend/dist`.

## Health check

With the default dev layout (no `SERVE_FRONTEND`), **GET /** still returns JSON. In all modes **GET /api/health** returns `{ "ok": true, "message": "..." }` for monitoring.
