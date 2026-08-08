import { Pool } from "pg";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Minimal .env loader so `next dev` from the repo root or apps/web both work.
for (const candidate of [join(process.cwd(), ".env"), join(process.cwd(), "..", "..", ".env")]) {
  if (existsSync(candidate)) {
    for (const line of readFileSync(candidate, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
    }
    break;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __ltPool: Pool | undefined;
}

export const pool: Pool =
  globalThis.__ltPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://legacy:legacy@localhost:5434/legacy_twin",
    max: 5,
  });
globalThis.__ltPool = pool;

export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export const DEMO_PROFILE_ID = "00000000-0000-0000-0000-000000000001";
