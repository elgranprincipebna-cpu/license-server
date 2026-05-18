import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { openLicenseDb } from "./db.js";
import { createRoutes } from "./routes.js";

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
dotenv.config({ path: envPath });

const app = express();
app.use(express.json({ limit: "64kb" }));

const corsOrigin = process.env.CORS_ORIGIN ?? "*";
app.use(
  cors({
    origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim()),
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const indexHtml = path.join(publicDir, "index.html");

const db = await openLicenseDb();
app.use(createRoutes(db));

// Only serve the admin UI on /. Do NOT use express.static (it can return HTML for /admin/* on some hosts).
app.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(indexHtml);
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
  console.log(`License server listening on ${host}:${port}`);
});
