"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError((await res.json()).error ?? "sign-in failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Sign in</h1>
      <p className="sub">Every action in the archive is tied to who you are and what was consented to.</p>
      <form onSubmit={onSubmit} className="card" style={{ display: "grid", gap: 12, maxWidth: 420 }}>
        <input type="email" name="email" placeholder="email" required autoFocus />
        <input type="password" name="password" placeholder="password" required />
        <button type="submit" disabled={busy}>{busy ? "…" : "Sign in"}</button>
        {error && <p className="mono" style={{ color: "var(--oxide)", margin: 0 }}>{error}</p>}
      </form>
      {process.env.NODE_ENV !== "production" && (
        <div className="card">
          <p className="mono muted" style={{ margin: 0 }}>
            Demo accounts — subject: miriam@demo.local / miriam-demo · family member:
            family@demo.local / family-demo
          </p>
        </div>
      )}
    </>
  );
}
