/**
 * Restore PostgreSQL database from a pg_dump plain SQL file.
 * WARNING: overwrites objects in the target database. Use on dev/test or after backup.
 *
 * Usage:
 *   node scripts/restore-database.mjs backups/inventory-backup-2026-07-05.sql
 */
import "dotenv/config";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const databaseUrl = process.env.DATABASE_URL?.trim();
const fileArg = process.argv[2];

if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

if (!fileArg) {
  console.error("Usage: node scripts/restore-database.mjs <path-to-backup.sql>");
  process.exit(1);
}

const sqlPath = path.resolve(root, fileArg);
if (!fs.existsSync(sqlPath)) {
  console.error(`File not found: ${sqlPath}`);
  process.exit(1);
}

const force = process.argv.includes("--yes");

async function confirmRestore(): Promise<boolean> {
  if (force) return true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `Restore ${sqlPath} into ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}? Type YES to continue: `,
      resolve
    );
  });
  rl.close();
  return answer.trim() === "YES";
}

const ok = await confirmRestore();
if (!ok) {
  console.log("Restore cancelled.");
  process.exit(0);
}

console.log("Restoring…");

const result = spawnSync("psql", [databaseUrl, "-f", sqlPath], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  console.error("Is psql installed and on your PATH?");
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("Restore complete.");
