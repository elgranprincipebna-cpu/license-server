import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { openLicenseDb } from "./db.js";
import { createRoutes } from "./routes.js";
import { resolvePublicDir } from "./resolvePublic.js";

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
dotenv.config({ path: envPath });

const PANEL_VERSION = 5;

const app = express();
app.use(express.json({ limit: "64kb" }));

const corsOrigin = process.env.CORS_ORIGIN ?? "*";
app.use(
  cors({
    origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim()),
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

const publicDir = resolvePublicDir();
const indexHtml = path.join(publicDir, "index.html");

const { db, meta: dbMeta } = await openLicenseDb();
app.use(createRoutes(db, PANEL_VERSION, dbMeta));

app.use(
  express.static(publicDir, {
    index: false,
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  })
);

app.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Panel-Version", String(PANEL_VERSION));
  res.sendFile(indexHtml);
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[license-server]", err);
  if (!res.headersSent) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

const port = Number(process.env.PORT ?? 8790);
const host = "0.0.0.0";
app.listen(port, host, () => {
  console.log(`License server v${PANEL_VERSION} on ${host}:${port} (panel ${indexHtml})`);
});
