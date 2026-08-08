// Create (or reset the password of) a user with a role on the demo profile.
//
//   npm run user -- <email> "<display name>" <role> <password>
//   e.g. npm run user -- benny@example.com "Benny" family s0me-Str0ng-pass
//
// Roles: subject | steward | contributor | family | support
// Against a remote managed database: DATABASE_URL=<external url> PGSSL=1 npm run user -- ...
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
  }
}

const DEMO_PROFILE_ID = "00000000-0000-0000-0000-000000000001";
const ROLES = ["subject", "steward", "contributor", "family", "support"];

const [email, displayName, role, password] = process.argv.slice(2);
if (!email || !displayName || !role || !password || !ROLES.includes(role)) {
  console.error('usage: npm run user -- <email> "<display name>" <role> <password>');
  console.error(`roles: ${ROLES.join(" | ")}`);
  process.exit(2);
}
if (password.length < 10) {
  console.error("password must be at least 10 characters");
  process.exit(2);
}

const salt = randomBytes(16).toString("hex");
const hash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;

const url = process.env.DATABASE_URL ?? "postgres://legacy:legacy@localhost:5434/legacy_twin";
const ssl = process.env.PGSSL ? { rejectUnauthorized: false } : undefined;
const client = new pg.Client({ connectionString: url, ssl });

try {
  await client.connect();
  const { rows } = await client.query(
    `insert into users (email, display_name, password_hash)
     values ($1, $2, $3)
     on conflict (email) do update set display_name = $2, password_hash = $3
     returning id`,
    [email.toLowerCase(), displayName, hash]
  );
  await client.query(
    `insert into grants (user_id, profile_id, role) values ($1, $2, $3)
     on conflict (user_id, profile_id) do update set role = $3`,
    [rows[0].id, DEMO_PROFILE_ID, role]
  );
  await client.query(
    "insert into audit_log (actor, action, subject, detail) values ($1, 'user.upserted', $2, $3)",
    [`cli:${email.toLowerCase()}`, rows[0].id, JSON.stringify({ role })]
  );
  console.log(`user ${email} (${role}) ready`);
} finally {
  await client.end();
}
