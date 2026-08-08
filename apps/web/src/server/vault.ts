import { createHash } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";

// Local-disk media vault (P3: originals are immutable, content-addressed, checksummed).
// Same interface an S3-backed vault implements later; only this module changes.

function vaultRoot(): string {
  const configured = process.env.VAULT_DIR ?? "./data/vault";
  // resolve relative to repo root whether cwd is the root or apps/web
  const base = existsSync(join(process.cwd(), "package.json")) && existsSync(join(process.cwd(), "db"))
    ? process.cwd()
    : resolve(process.cwd(), "..", "..");
  return resolve(base, configured);
}

export interface VaultRecord {
  sha256: string;
  vaultPath: string;
}

export function putOriginal(buf: Buffer, filename: string): VaultRecord {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const safe = basename(filename).replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const dir = join(vaultRoot(), "originals");
  mkdirSync(dir, { recursive: true });
  const vaultPath = join(dir, `${sha256}-${safe}`);
  // Immutable: if the object exists, never rewrite it.
  if (!existsSync(vaultPath)) writeFileSync(vaultPath, buf, { flag: "wx" });
  return { sha256, vaultPath };
}
