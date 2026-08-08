import { NextRequest, NextResponse } from "next/server";
import { destroySession, getSessionUser, SESSION_COOKIE } from "@/server/auth";
import { audit } from "@/server/pdp";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  if (user) await audit(user.actor, "auth.logout", user.userId);

  // Plain HTML form post — redirect back to the login page.
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
