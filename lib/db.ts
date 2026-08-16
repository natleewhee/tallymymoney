// HTTP driver, not the TCP pool driver — Vercel's serverless functions are
// short-lived, and a pooled TCP connection just means connection-storm
// problems at this scale for no benefit. See ARCHITECTURE.md §5.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });
