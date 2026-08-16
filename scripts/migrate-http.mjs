// Applies drizzle/*.sql migrations over HTTPS via @neondatabase/serverless,
// instead of drizzle-kit's default raw-TCP/websocket migrator. Useful
// wherever raw Postgres wire protocol is blocked (proxies, some sandboxes)
// but plain HTTPS isn't — the app itself already talks to Neon this way
// (see lib/db.ts), so this just reuses the same path for migrations.
//
// Usage: DATABASE_URL=postgresql://... node scripts/migrate-http.mjs

import { neon } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "drizzle");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const contents = readFileSync(join(migrationsDir, file), "utf-8");
  const statements = contents
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Applying ${file} (${statements.length} statement(s))...`);
  for (const stmt of statements) {
    await sql(stmt);
  }
}

console.log("Done.");
