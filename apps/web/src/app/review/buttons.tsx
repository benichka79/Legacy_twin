"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReviewButtons({ factId }: { factId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: "approve" | "reject") {
    setBusy(true);
    await fetch("/api/facts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fact_id: factId, action }),
    });
    router.refresh();
  }

  return (
    <p style={{ marginBottom: 0, display: "flex", gap: 10 }}>
      <button disabled={busy} onClick={() => act("approve")}>Approve</button>
      <button disabled={busy} className="reject" onClick={() => act("reject")}>Reject</button>
    </p>
  );
}
