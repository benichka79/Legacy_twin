import { NextRequest, NextResponse } from "next/server";
import { q } from "@/server/db";
import { audit } from "@/server/pdp";
import { verifyPassword, createSession, SESSION_COOKIE } from "@/server/auth";

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json()) as { email?: string; password?: string };
  if (!email?.trim() || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const [user] = await q<{ id: string; password_hash: string }>(
    "select id, password_hash from users where email = $1",
    [email.trim().toLowerCase()]
  );
  // Uniform error for unknown user and wrong password — no account probing.
  if (!user || !verifyPassword(password, user.password_hash)) {
    await audit(`anon:${email.trim().toLowerCase()}`, "auth.login_failed");
    return NextResponse.json({ error: "invalid email or password" }, { status: 401 });
  }

  const { token, maxAge } = await createSession(user.id);
  await audit(`user:${email.trim().toLowerCase()}`, "auth.login", user.id);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return res;
}
