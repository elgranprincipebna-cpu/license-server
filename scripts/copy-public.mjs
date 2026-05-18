import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public");
const dest = path.join(root, "dist", "public");

function copyRecursive(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, name.name);
    const destPath = path.join(to, name.name);
    if (name.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursive(src, dest);
console.log("[build] copied public/ -> dist/public/ (recursive)");
