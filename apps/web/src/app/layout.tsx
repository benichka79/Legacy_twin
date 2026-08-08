import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Legacy Twin — walking skeleton",
  description: "Consent-first legacy archive prototype",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <span className="brand">Legacy Twin</span>
          <nav>
            <Link href="/">Dashboard</Link>
            <Link href="/capture">Capture</Link>
            <Link href="/review">Review</Link>
            <Link href="/ask">Ask</Link>
            <a href="/api/export">Export</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site">
          Walking skeleton · auth stubbed (subject:miriam / family:demo) · adapters:{" "}
          {process.env.LLM_PROVIDER ?? "mock"}
        </footer>
      </body>
    </html>
  );
}
