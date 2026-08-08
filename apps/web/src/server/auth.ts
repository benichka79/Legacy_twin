import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { q, DEMO_PROFILE_ID } from "./db";

// Session auth (dependency-free): scrypt passwords, HttpOnly cookie backed by
// auth_sessions. Actor strings are "<role>:<email>" so the PDP's role/audience
// matching works unchanged. Real identity verification (IDV, liveness) is Phase 2.

export const SESSION_COOKIE = "lt_session";
const SESSION_TTL_DAYS = 7;

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  actor: string; // "<role>:<email>" — what PDP, audit, and persistence consume
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function createSession(userId: string): Promise<{ token: string; maxAge: number }> {
  const token = randomBytes(32).toString("hex");
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;
  await q(
    "insert into auth_sessions (token, user_id, expires_at) values ($1, $2, now() + make_interval(secs => $3))",
    [token, userId, maxAge]
  );
  return { token, maxAge };
}

export async function destroySession(token: string): Promise<void> {
  await q("delete from auth_sessions where token = $1", [token]);
}

/** Resolve the current user from the session cookie; null when signed out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await q<{ user_id: string; email: string; display_name: string; role: string }>(
    `select u.id as user_id, u.email, u.display_name, g.role
     from auth_sessions s
     join users u on u.id = s.user_id
     join grants g on g.user_id = u.id and g.profile_id = $2
     where s.token = $1 and s.expires_at > now()`,
    [token, DEMO_PROFILE_ID]
  );
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    actor: `${row.role}:${row.email}`,
  };
}

/** Server-component guard: redirect to /login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Route-handler guard: returns the user or null (caller responds 401/403). */
export async function requireRole(...roles: string[]): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || (roles.length > 0 && !roles.includes(user.role))) return null;
  return user;
}
