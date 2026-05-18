import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { LicenseDb } from "./db.js";
import { requireAdmin } from "./middleware/adminAuth.js";

const verifyBody = z.object({
  machineId: z.preprocess((v) => String(v ?? "").trim(), z.string().min(8).max(512)),
  licenseKey: z.preprocess((v) => {
    const s = String(v ?? "").trim();
    return s.length === 0 ? undefined : s;
  }, z.string().min(4).max(128).optional()),
});

const createBody = z.object({
  machineId: z.preprocess((v) => String(v ?? "").trim(), z.string().min(8).max(512)),
  label: z.string().max(200).optional(),
  expiresAt: z.preprocess((v) => String(v ?? "").trim(), z.string().min(4)),
});

const extendBody = z.object({
  expiresAt: z.preprocess((v) => String(v ?? "").trim(), z.string().min(4)),
  label: z.string().max(200).optional(),
});

function rowToJson(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    machine_id: String(row.machine_id),
    license_key: String(row.license_key),
    label: row.label != null ? String(row.label) : null,
    expires_at: String(row.expires_at),
    created_at: String(row.created_at),
  };
}

export function createRoutes(db: LicenseDb, panelVersion = 1) {
  const r = Router();

  r.get("/health", (_req, res) => {
    res.json({ ok: true, service: "minimarket-license-server", panelVersion });
  });

  r.post("/verify-license", (req, res) => {
    const parsed = verifyBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ valid: false, error: "Invalid payload" });
    }
    const { machineId, licenseKey } = parsed.data;

    let row: { machine_id: string; license_key: string; expires_at: string } | undefined;

    if (licenseKey) {
      row = db
        .prepare(
          `SELECT machine_id, license_key, expires_at FROM licenses WHERE machine_id = ? AND license_key = ?`
        )
        .get(machineId, licenseKey) as typeof row;

      if (!row) {
        const byMachine = db
          .prepare(`SELECT machine_id, license_key, expires_at FROM licenses WHERE machine_id = ?`)
          .get(machineId) as typeof row;
        if (byMachine) {
          return res.json({
            valid: false,
            reason: "license_key_mismatch",
            machineId,
            hint: "This machine is registered but the license key does not match. Use the key shown in the license admin panel.",
          });
        }
        return res.json({
          valid: false,
          reason: "unauthorized",
          machineId,
          hint: "Machine not registered. Add it in the license server admin panel.",
        });
      }
    } else {
      row = db
        .prepare(`SELECT machine_id, license_key, expires_at FROM licenses WHERE machine_id = ?`)
        .get(machineId) as typeof row;

      if (!row) {
        return res.json({
          valid: false,
          reason: "unauthorized",
          machineId,
          hint: "Machine not registered. Add it in the license server admin panel.",
        });
      }
    }

    const expires = new Date(row.expires_at).getTime();
    if (Number.isNaN(expires) || expires <= Date.now()) {
      return res.json({
        valid: false,
        reason: "expired",
        machineId,
        expiresAt: row.expires_at,
      });
    }

    return res.json({
      valid: true,
      machineId: row.machine_id,
      expiresAt: row.expires_at,
    });
  });

  r.get("/admin/licenses", requireAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, machine_id, license_key, label, expires_at, created_at FROM licenses ORDER BY datetime(expires_at) ASC`
      )
      .all();
    res.json({ licenses: rows.map(rowToJson) });
  });

  r.post("/admin/licenses", requireAdmin, (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
    const { machineId, label, expiresAt } = parsed.data;
    if (Number.isNaN(new Date(expiresAt).getTime())) {
      return res.status(400).json({ error: "expiresAt must be a valid date" });
    }
    const id = nanoid();
    const licenseKey = `POS-${nanoid(12).toUpperCase()}`;
    try {
      db.prepare(
        `INSERT INTO licenses (id, machine_id, license_key, label, expires_at) VALUES (?, ?, ?, ?, ?)`
      ).run(id, machineId, licenseKey, label ?? null, expiresAt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "insert failed";
      if (/UNIQUE constraint failed/i.test(msg)) {
        return res.status(409).json({ error: "This machine_id is already registered", code: "MACHINE_EXISTS" });
      }
      return res.status(409).json({ error: msg });
    }
    res.status(201).json({ id, machineId, licenseKey, label: label ?? null, expiresAt });
  });

  r.patch("/admin/licenses/:id", requireAdmin, (req, res) => {
    const parsed = extendBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
    if (Number.isNaN(new Date(parsed.data.expiresAt).getTime())) {
      return res.status(400).json({ error: "expiresAt must be a valid date" });
    }
    const existing = db.prepare(`SELECT * FROM licenses WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const label = parsed.data.label !== undefined ? parsed.data.label : (existing.label as string | null);
    db.prepare(`UPDATE licenses SET expires_at = ?, label = ? WHERE id = ?`).run(
      parsed.data.expiresAt,
      label,
      req.params.id
    );
    const row = db.prepare(`SELECT * FROM licenses WHERE id = ?`).get(req.params.id)!;
    res.json(rowToJson(row));
  });

  r.delete("/admin/licenses/:id", requireAdmin, (req, res) => {
    const info = db.prepare(`DELETE FROM licenses WHERE id = ?`).run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  return r;
}
