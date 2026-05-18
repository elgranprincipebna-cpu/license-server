import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { LicenseDb } from "./db.js";
import {
  endOfDayIso,
  isValidAddonCode,
  LICENSE_ADDON_CATALOG,
  normalizeAddonList,
  renewExpiresAtIso,
} from "./addons.js";
import { requireAdmin } from "./middleware/adminAuth.js";
import { getLicenseAddons, rowToLicenseJson, setLicenseAddons } from "./licenseRepo.js";

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
  addons: z.array(z.string()).optional(),
});

const extendBody = z.object({
  expiresAt: z.preprocess((v) => String(v ?? "").trim(), z.string().min(4)).optional(),
  label: z.string().max(200).optional(),
  addons: z.array(z.string()).optional(),
});

const renewBody = z.object({
  months: z.union([z.literal(6), z.literal(12)]),
});

const addonsBody = z.object({
  addons: z.array(z.string()),
});

function licenseRowByMachine(
  db: LicenseDb,
  machineId: string,
  licenseKey?: string
): { id: string; machine_id: string; license_key: string; expires_at: string } | "mismatch" | null {
  if (licenseKey) {
    const row = db
      .prepare(
        `SELECT id, machine_id, license_key, expires_at FROM licenses WHERE machine_id = ? AND license_key = ?`
      )
      .get(machineId, licenseKey) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: String(row.id),
        machine_id: String(row.machine_id),
        license_key: String(row.license_key),
        expires_at: String(row.expires_at),
      };
    }
    const byMachine = db
      .prepare(`SELECT id FROM licenses WHERE machine_id = ?`)
      .get(machineId);
    return byMachine ? "mismatch" : null;
  }
  const row = db
    .prepare(`SELECT id, machine_id, license_key, expires_at FROM licenses WHERE machine_id = ?`)
    .get(machineId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    machine_id: String(row.machine_id),
    license_key: String(row.license_key),
    expires_at: String(row.expires_at),
  };
}

function checkNotExpired(expiresAt: string): boolean {
  const expiresMs = new Date(expiresAt).getTime();
  return !Number.isNaN(expiresMs) && expiresMs >= Date.now();
}

export function createRoutes(db: LicenseDb, panelVersion = 1) {
  const r = Router();

  r.get("/health", (_req, res) => {
    res.json({ ok: true, service: "minimarket-license-server", panelVersion });
  });

  r.get("/admin/addons/catalog", requireAdmin, (_req, res) => {
    res.json({ addons: LICENSE_ADDON_CATALOG });
  });

  r.post("/verify-license", (req, res) => {
    const parsed = verifyBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ valid: false, error: "Invalid payload" });
    }
    const { machineId, licenseKey } = parsed.data;

    const found = licenseRowByMachine(db, machineId, licenseKey);
    if (found === null) {
      return res.json({
        valid: false,
        reason: "unauthorized",
        machineId,
        hint: "Machine not registered. Add it in the license server admin panel.",
      });
    }
    if (found === "mismatch") {
      return res.json({
        valid: false,
        reason: "license_key_mismatch",
        machineId,
        hint: "This machine is registered but the license key does not match.",
      });
    }

    if (!checkNotExpired(found.expires_at)) {
      return res.json({
        valid: false,
        reason: "expired",
        machineId,
        expiresAt: found.expires_at,
        addons: getLicenseAddons(db, found.id),
      });
    }

    return res.json({
      valid: true,
      machineId: found.machine_id,
      expiresAt: found.expires_at,
      addons: getLicenseAddons(db, found.id),
    });
  });

  r.get("/admin/licenses", requireAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, machine_id, license_key, label, expires_at, created_at FROM licenses ORDER BY datetime(expires_at) ASC`
      )
      .all();
    res.json({ licenses: rows.map((row) => rowToLicenseJson(db, row)) });
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
    const addons = normalizeAddonList(parsed.data.addons);
    try {
      db.transaction((tx) => {
        tx.prepare(
          `INSERT INTO licenses (id, machine_id, license_key, label, expires_at) VALUES (?, ?, ?, ?, ?)`
        ).run(id, machineId, licenseKey, label ?? null, expiresAt);
        if (addons.length > 0) setLicenseAddons(tx, id, addons);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "insert failed";
      if (/UNIQUE constraint failed/i.test(msg)) {
        return res.status(409).json({ error: "This machine_id is already registered", code: "MACHINE_EXISTS" });
      }
      return res.status(409).json({ error: msg });
    }
    res.status(201).json({
      id,
      machineId,
      licenseKey,
      label: label ?? null,
      expiresAt,
      addons,
    });
  });

  r.post("/admin/licenses/:id/renew", requireAdmin, (req, res) => {
    const parsed = renewBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "months must be 6 or 12" });
    const existing = db.prepare(`SELECT * FROM licenses WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const expiresAt = renewExpiresAtIso(String(existing.expires_at), parsed.data.months);
    db.prepare(`UPDATE licenses SET expires_at = ? WHERE id = ?`).run(expiresAt, req.params.id);
    const row = db.prepare(`SELECT * FROM licenses WHERE id = ?`).get(req.params.id)!;
    res.json({
      ...rowToLicenseJson(db, row),
      renewedMonths: parsed.data.months,
    });
  });

  r.put("/admin/licenses/:id/addons", requireAdmin, (req, res) => {
    const parsed = addonsBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
    const existing = db.prepare(`SELECT id FROM licenses WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const addons = normalizeAddonList(parsed.data.addons);
    for (const code of addons) {
      if (!isValidAddonCode(code)) {
        return res.status(400).json({ error: `Addon desconocido: ${code}` });
      }
    }
    setLicenseAddons(db, req.params.id, addons);
    const row = db.prepare(`SELECT * FROM licenses WHERE id = ?`).get(req.params.id)!;
    res.json(rowToLicenseJson(db, row));
  });

  r.patch("/admin/licenses/:id", requireAdmin, (req, res) => {
    const parsed = extendBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

    const existing = db.prepare(`SELECT * FROM licenses WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const expiresAt =
      parsed.data.expiresAt !== undefined ? parsed.data.expiresAt : String(existing.expires_at);
    if (Number.isNaN(new Date(expiresAt).getTime())) {
      return res.status(400).json({ error: "expiresAt must be a valid date" });
    }
    const label =
      parsed.data.label !== undefined ? parsed.data.label : (existing.label as string | null);

    db.prepare(`UPDATE licenses SET expires_at = ?, label = ? WHERE id = ?`).run(
      expiresAt,
      label,
      req.params.id
    );

    if (parsed.data.addons !== undefined) {
      const addons = normalizeAddonList(parsed.data.addons);
      setLicenseAddons(db, req.params.id, addons);
    }

    const row = db.prepare(`SELECT * FROM licenses WHERE id = ?`).get(req.params.id)!;
    res.json(rowToLicenseJson(db, row));
  });

  r.delete("/admin/licenses/:id", requireAdmin, (req, res) => {
    const info = db.prepare(`DELETE FROM licenses WHERE id = ?`).run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  return r;
}
