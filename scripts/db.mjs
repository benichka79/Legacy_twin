// Tiny migration/seed runner: node scripts/db.mjs migrate | seed
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader (no dependency): only sets vars not already in the environment.
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
  }
}

const url = process.env.DATABASE_URL ?? "postgres://legacy:legacy@localhost:5434/legacy_twin";
const client = new pg.Client({ connectionString: url });
const cmd = process.argv[2];

async function migrate() {
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
  );
  const dir = join(root, "db", "migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const { rowCount } = await client.query("select 1 from schema_migrations where name = $1", [name]);
    if (rowCount) continue;
    console.log(`applying ${name}`);
    await client.query("begin");
    try {
      await client.query(readFileSync(join(dir, name), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [name]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }
  console.log("migrations up to date");
}

async function seed() {
  await client.query(readFileSync(join(root, "db", "seed.sql"), "utf8"));
  console.log("seeded");
}

try {
  await client.connect();
  if (cmd === "migrate") await migrate();
  else if (cmd === "seed") await seed();
  else {
    console.error("usage: node scripts/db.mjs migrate|seed");
    process.exit(2);
  }
} finally {
  await client.end();
}
