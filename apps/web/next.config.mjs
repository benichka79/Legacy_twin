import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg uses Node APIs; keep it external to the server bundle.
  serverExternalPackages: ["pg"],
  // Repo root, not any stray lockfile further up the tree.
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
};

export default nextConfig;
