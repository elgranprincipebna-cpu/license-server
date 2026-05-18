export const LICENSE_ADDON_CATALOG = [
  {
    code: "restaurant",
    label: "Restaurante",
    description: "Mesas, comandas y modo restaurante en el POS.",
  },
  {
    code: "delivery",
    label: "Delivery",
    description: "Pedidos a domicilio y repartidores en el POS.",
  },
] as const;

export type LicenseAddonCode = (typeof LICENSE_ADDON_CATALOG)[number]["code"];

const VALID_CODES = new Set<string>(LICENSE_ADDON_CATALOG.map((a) => a.code));

export function isValidAddonCode(code: string): code is LicenseAddonCode {
  return VALID_CODES.has(code);
}

export function normalizeAddonList(raw: unknown): LicenseAddonCode[] {
  if (!Array.isArray(raw)) return [];
  const out: LicenseAddonCode[] = [];
  for (const item of raw) {
    const code = String(item).trim().toLowerCase();
    if (isValidAddonCode(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export function endOfDayIso(d: Date): string {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 0)
  ).toISOString();
}

/** Extend from the later of now or current expiry by N months. */
export function renewExpiresAtIso(currentExpiresIso: string, months: number): string {
  const now = new Date();
  const current = new Date(currentExpiresIso);
  const base =
    !Number.isNaN(current.getTime()) && current.getTime() > now.getTime() ? current : now;
  const next = new Date(base);
  next.setUTCMonth(next.getUTCMonth() + months);
  return endOfDayIso(next);
}
