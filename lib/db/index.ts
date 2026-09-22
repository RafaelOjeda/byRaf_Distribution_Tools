import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Lazily initialized. `neon()` throws if DATABASE_URL is unset, and
 * Next.js evaluates top-level module code at build time — a module-level
 * `const db = ...` would crash `next build` before Neon is provisioned.
 * Deliberately a plain cached `let`, not a Proxy: a Proxy wrapper here
 * breaks libraries (e.g. NextAuth) that inspect the client object.
 */
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL!);
    _db = drizzle(sql, { schema });
  }
  return _db;
}
