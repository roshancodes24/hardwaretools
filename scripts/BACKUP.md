# Database backup and restore

The shop database holds products, stock, sales, purchases, and customers. **Back it up regularly.**

## Requirements

- PostgreSQL client tools on your PATH: `pg_dump` and `psql` (installed with PostgreSQL).
- A configured `.env` with `DATABASE_URL` (see `.env.example`).

## Backup

From the project root:

```bash
npm run db:backup
```

Creates `backups/inventory-backup-<timestamp>.sql` (gitignored).

Custom path:

```bash
node scripts/backup-database.mjs backups/before-migration.sql
```

Windows (same as above):

```powershell
npm run db:backup
```

## Restore

**This overwrites data in the database pointed to by `DATABASE_URL`.** Take a fresh backup first.

```bash
npm run db:restore -- backups/inventory-backup-2026-07-05.sql
```

You will be prompted to type `YES` to confirm. Non-interactive:

```bash
node scripts/restore-database.mjs backups/my-backup.sql --yes
```

## Suggested schedule

- **Daily** automated backup on the server (Task Scheduler / cron calling `npm run db:backup`).
- **Before** bulk imports, migrations, or catalog clears.
- Keep at least **7 days** of backups off the same machine (USB / cloud).

## Railway / hosted PostgreSQL

Use your provider’s backup feature as well. These scripts are for local/dev and self-hosted installs.
