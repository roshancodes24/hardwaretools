/**
 * Backup PostgreSQL database using pg_dump.
 * Requires `pg_dump` on PATH (PostgreSQL client tools).
 *
 * Usage:
 *   node scripts/backup-database.mjs
 *   node scripts/backup-database.mjs backups/my-backup.sql
 */
import "dotenv/config";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  process.exit(1);
}

const defaultDir = path.join(root, "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outArg = process.argv[2];
const outPath = outArg
  ? path.resolve(root, outArg)
  : path.join(defaultDir, `inventory-backup-${stamp}.sql`);

fs.mkdirSync(path.dirname(outPath), { recursive: true });

console.log(`Backing up to ${outPath} …`);

const result = spawnSync(
  "pg_dump",
  ["--no-owner", "--no-acl", "--format=plain", "--file", outPath, databaseUrl],
  { stdio: "inherit", shell: process.platform === "win32" }
);

if (result.error) {
  console.error(result.error.message);
  console.error("Is pg_dump installed and on your PATH?");
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
console.log(`Backup complete (${sizeKb} KB).`);
