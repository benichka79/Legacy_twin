"use client";

import { useState } from "react";

export function CaptureForm() {
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus("Uploading…");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      setStatus(
        res.ok
          ? `Stored immutably (${data.kind}, sha256 ${data.sha256.slice(0, 12)}…). The worker will process it — run: npm run worker`
          : `Error: ${data.error}`
      );
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="card">
        <input type="file" name="file" accept=".txt,.md,audio/*" required />
        <p>
          <button type="submit" disabled={busy}>Upload to vault</button>
        </p>
        {status && <p className="mono">{status}</p>}
      </form>
    </>
  );
}
