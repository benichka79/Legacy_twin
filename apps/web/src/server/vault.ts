import { createHash } from "node:crypto";
import { basename } from "node:path";
import { q } from "./db";

// Content-addressed media vault, DB-backed (P3: immutable, checksummed
// originals). Same bytes → same sha256 → one row, never overwritten. Backed up
// with the database and visible to web and worker on any host. The S3 vault
// with object-lock replaces this at scale (ARCHITECTURE.md, Phase 4) behind
// the same interface.

export interface VaultRecord {
  sha256: string;
  vaultPath: string;
}

export async function putOriginal(buf: Buffer, filename: string): Promise<VaultRecord> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const safe = basename(filename).replace(/[^\w.\-]+/g, "_").slice(0, 80);
  await q(
    "insert into vault_blobs (sha256, filename, bytes) values ($1, $2, $3) on conflict (sha256) do nothing",
    [sha256, safe, buf]
  );
  return { sha256, vaultPath: `db://${sha256}` };
}
