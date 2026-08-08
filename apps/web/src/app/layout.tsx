import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/server/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Legacy Twin — walking skeleton",
  description: "Consent-first legacy archive prototype",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en">
      <body>
        <header className="site">
          <span className="brand">Legacy Twin</span>
          <nav>
            <Link href="/">Dashboard</Link>
            {user?.role === "subject" && <Link href="/capture">Capture</Link>}
            {user?.role === "subject" && <Link href="/review">Review</Link>}
            <Link href="/ask">Ask</Link>
            {user?.role === "subject" && <a href="/api/export">Export</a>}
          </nav>
          <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
            {user ? (
              <>
                <span className="muted">{user.displayName} · {user.role}</span>
                <form action="/api/auth/logout" method="post" style={{ margin: 0 }}>
                  <button type="submit">Sign out</button>
                </form>
              </>
            ) : (
              <Link href="/login">Sign in</Link>
            )}
          </span>
        </header>
        <main>{children}</main>
        <footer className="site">
          Walking skeleton · adapters: {process.env.LLM_PROVIDER ?? "mock"}
        </footer>
      </body>
    </html>
  );
}
