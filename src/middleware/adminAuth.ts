import type { RequestHandler } from "express";

export const requireAdmin: RequestHandler = (req, res, next) => {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) {
    return res.status(503).json({ error: "ADMIN_API_KEY is not configured on license server" });
  }
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== key) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};
