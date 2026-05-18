import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs, { type SqlDatabase } from "sql.js";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "licenses.db")
  : path.join(SERVER_ROOT, "data", "licenses.db");

export type LicenseDb = {
  prepare(sql: string): {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): { changes: number };
  };
  exec(sql: string): void;
  transaction(work: (db: LicenseDb) => void): void;
};

class PersistedDb implements LicenseDb {
  private deferSave = false;

  constructor(
    private readonly db: SqlDatabase,
    private readonly filePath: string
  ) {}

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, Buffer.from(this.db.export()));
  }

  exec(sql: string): void {
    this.db.exec(sql);
    if (!this.deferSave) this.save();
  }

  transaction(work: (db: LicenseDb) => void): void {
    const prev = this.deferSave;
    this.deferSave = true;
    try {
      work(this);
    } finally {
      this.deferSave = prev;
      this.save();
    }
  }

  prepare(sql: string) {
    const self = this;
    const mutating = /^\s*(insert|update|delete)\s/i.test(sql);
    return {
      get(...params: unknown[]) {
        const stmt = self.db.prepare(sql);
        stmt.bind(params.length ? (params as never) : ([] as never));
        const has = stmt.step();
        const row = has ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
        stmt.free();
        return row;
      },
      all(...params: unknown[]) {
        const stmt = self.db.prepare(sql);
        stmt.bind(params.length ? (params as never) : ([] as never));
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
        stmt.free();
        return rows;
      },
      run(...params: unknown[]) {
        const stmt = self.db.prepare(sql);
        stmt.bind(params.length ? (params as never) : ([] as never));
        stmt.step();
        stmt.free();
        const changes = self.db.getRowsModified();
        if (mutating && !self.deferSave) self.save();
        return { changes };
      },
    };
  }
}

function findWasm(): string {
  const candidates = [
    path.join(SERVER_ROOT, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    path.join(SERVER_ROOT, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("sql-wasm.wasm not found. Run npm install from repo root.");
}

export async function openLicenseDb(dbPath = process.env.DATABASE_PATH ?? defaultPath): Promise<LicenseDb> {
  const resolved = path.isAbsolute(dbPath) ? dbPath : path.join(SERVER_ROOT, dbPath);
  const wasmBinary = fs.readFileSync(findWasm());
  const SQL = await initSqlJs({ wasmBinary });
  const buf = fs.existsSync(resolved) ? fs.readFileSync(resolved) : undefined;
  const raw = buf ? new SQL.Database(buf) : new SQL.Database();
  const db = new PersistedDb(raw, resolved);

  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL UNIQUE,
      license_key TEXT NOT NULL UNIQUE,
      label TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_licenses_expires ON licenses(expires_at);

    CREATE TABLE IF NOT EXISTS license_addons (
      license_id TEXT NOT NULL,
      addon_code TEXT NOT NULL,
      PRIMARY KEY (license_id, addon_code),
      FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_license_addons_code ON license_addons(addon_code);
  `);

  console.log(`[license-db] ${resolved}`);

  const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
  const hasVolume = Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH);
  if (onRailway && !hasVolume) {
    console.warn(
      "[license-db] WARNING: No Railway Volume detected. licenses.db lives on ephemeral disk — " +
        "every redeploy wipes all licenses. Add a Volume in Railway (see RAILWAY-DEPLOY.txt)."
    );
  } else if (onRailway && hasVolume) {
    console.log(`[license-db] Persistent volume: ${process.env.RAILWAY_VOLUME_MOUNT_PATH}`);
  }

  return db;
}
