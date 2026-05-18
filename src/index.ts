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
const allowedOrigins =
  corsOrigin === "*"
    ? true
    : corsOrigin.split(",").map((s) => s.trim());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins === true) return cb(null, true);
      if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) return cb(null, true);
      // Dev: allow any localhost port (Vite may use 5173, 5174, etc.)
      if (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      cb(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
app.use(express.static(publicDir));

const db = await openLicenseDb();
app.use(createRoutes(db));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT ?? 8790);
const host = "0.0.0.0";
app.listen(port, host, () => {
  console.log(`License server listening on ${host}:${port}`);
});
