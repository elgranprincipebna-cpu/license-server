import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolvePublicDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "public"),
    path.join(here, "..", "public"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  throw new Error("public/index.html not found (run npm run build)");
}
