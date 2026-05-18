import type { LicenseDb } from "./db.js";
import { normalizeAddonList, type LicenseAddonCode } from "./addons.js";

export function getLicenseAddons(db: LicenseDb, licenseId: string): LicenseAddonCode[] {
  const rows = db
    .prepare(`SELECT addon_code FROM license_addons WHERE license_id = ? ORDER BY addon_code`)
    .all(licenseId) as { addon_code: string }[];
  return normalizeAddonList(rows.map((r) => r.addon_code));
}

export function setLicenseAddons(db: LicenseDb, licenseId: string, addons: LicenseAddonCode[]): void {
  db.transaction((tx) => {
    tx.prepare(`DELETE FROM license_addons WHERE license_id = ?`).run(licenseId);
    const ins = tx.prepare(`INSERT INTO license_addons (license_id, addon_code) VALUES (?, ?)`);
    for (const code of addons) {
      ins.run(licenseId, code);
    }
  });
}

export function rowToLicenseJson(db: LicenseDb, row: Record<string, unknown>) {
  const id = String(row.id);
  return {
    id,
    machine_id: String(row.machine_id),
    license_key: String(row.license_key),
    label: row.label != null ? String(row.label) : null,
    expires_at: String(row.expires_at),
    created_at: String(row.created_at),
    addons: getLicenseAddons(db, id),
  };
}
