const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { hashPassword } = require('./auth');

const DATA_DIR = path.join(__dirname, 'data');

function resolveDbPath() {
  const provider = String(process.env.PROPASS_DB_PROVIDER || 'sqlite').toLowerCase();
  if (provider !== 'sqlite') {
    throw new Error(`DB provider not implemented yet: ${provider} (only sqlite for now)`);
  }

  const override = String(process.env.PROPASS_SQLITE_PATH || '').trim();
  if (override) return override;

  // Preferred default name (requested): database.db
  const preferred = path.join(DATA_DIR, 'database.db');

  // Backward compat: if an old central.db exists, keep using it unless database.db already exists.
  const legacy = path.join(DATA_DIR, 'central.db');
  try {
    if (!fs.existsSync(preferred) && fs.existsSync(legacy)) return legacy;
  } catch (_) {
    // ignore
  }

  return preferred;
}

const DB_PATH = resolveDbPath();

function ensureDbInitialized(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      name TEXT,
      email TEXT,
      quota_remaining INTEGER NOT NULL DEFAULT 0,
      monthly_limit INTEGER NOT NULL DEFAULT 100,
      valid_until TEXT,
      password_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      UNIQUE(client_id, name)
    );

    CREATE TABLE IF NOT EXISTS master_dumps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      site_id INTEGER,
      uid TEXT,
      dump_hex TEXT NOT NULL,
      source TEXT NOT NULL, -- manual|direct
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS dumps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'global', -- global|client|site (future)
      client_id INTEGER,
      site_id INTEGER,
      uid TEXT,
      dump_hex TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL, -- manual|direct
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS copy_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT UNIQUE, -- optional id from clients (renderer sync)
      ts INTEGER NOT NULL, -- epoch ms
      status TEXT NOT NULL, -- success|fail
      source TEXT, -- optional: ui|client|admin
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS copy_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      company_name TEXT,
      action TEXT NOT NULL, -- Copié|Échec copie
      ts INTEGER NOT NULL, -- epoch ms
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
    CREATE INDEX IF NOT EXISTS idx_sites_client_id ON sites(client_id);
    CREATE INDEX IF NOT EXISTS idx_master_dumps_client_id ON master_dumps(client_id);
    CREATE INDEX IF NOT EXISTS idx_dumps_scope_active ON dumps(scope, is_active);

    CREATE INDEX IF NOT EXISTS idx_copy_events_ts ON copy_events(ts);
    CREATE INDEX IF NOT EXISTS idx_copy_events_status ON copy_events(status);

    CREATE INDEX IF NOT EXISTS idx_copy_logs_ts ON copy_logs(ts);
    CREATE INDEX IF NOT EXISTS idx_copy_logs_action ON copy_logs(action);
    CREATE INDEX IF NOT EXISTS idx_copy_logs_company ON copy_logs(company_name);
  `);

  // Lightweight migration for existing DBs (older schema without sites/site_id)
  try {
    const cols = db.prepare('PRAGMA table_info(master_dumps)').all();
    const hasSiteId = Array.isArray(cols) && cols.some((c) => String(c.name) === 'site_id');
    if (!hasSiteId) {
      db.exec('ALTER TABLE master_dumps ADD COLUMN site_id INTEGER');
    }
  } catch (_) {
    // ignore
  }

  // Create site_id index only if the column exists (avoids failure on older DBs).
  try {
    const cols2 = db.prepare('PRAGMA table_info(master_dumps)').all();
    const hasSiteId2 = Array.isArray(cols2) && cols2.some((c) => String(c.name) === 'site_id');
    if (hasSiteId2) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_master_dumps_site_id ON master_dumps(site_id)');
    }
  } catch (_) {
    // ignore
  }

  const now = new Date().toISOString();

  // --- Clients columns migration (customer database fields) ---
  try {
    const cols = db.prepare('PRAGMA table_info(clients)').all();
    const has = (name) => Array.isArray(cols) && cols.some((c) => String(c.name) === name);
    if (!has('company_name')) db.exec('ALTER TABLE clients ADD COLUMN company_name TEXT');
    if (!has('legal_form')) db.exec('ALTER TABLE clients ADD COLUMN legal_form TEXT');
    if (!has('sales_rep')) db.exec('ALTER TABLE clients ADD COLUMN sales_rep TEXT');
    if (!has('contact_first_name')) db.exec('ALTER TABLE clients ADD COLUMN contact_first_name TEXT');
    if (!has('contact_last_name')) db.exec('ALTER TABLE clients ADD COLUMN contact_last_name TEXT');
    if (!has('contact_phone')) db.exec('ALTER TABLE clients ADD COLUMN contact_phone TEXT');
    if (!has('is_active')) db.exec('ALTER TABLE clients ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
    if (!has('contract_start')) db.exec('ALTER TABLE clients ADD COLUMN contract_start TEXT');
  } catch (_) {
    // ignore
  }

  // Seed default admin (online login)
  const adminUser = String(process.env.ADMIN_USERNAME || 'admin');
  const adminPass = String(process.env.ADMIN_PASSWORD || 'admin123');
  const existingAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get(adminUser);
  if (!existingAdmin) {
    db.prepare(
      'INSERT INTO admins (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(adminUser, hashPassword(adminPass), now, now);
  } else {
    // Keep admin credentials controlled by environment (useful for local tests & deployments).
    db.prepare('UPDATE admins SET password_hash = ?, updated_at = ? WHERE username = ?')
      .run(hashPassword(adminPass), now, adminUser);
  }

  const existing = db.prepare('SELECT id FROM clients WHERE username = ?').get('client1');
  if (!existing) {
    const pw = hashPassword('client1');
    db.prepare(
      'INSERT INTO clients (username, name, email, quota_remaining, monthly_limit, valid_until, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('client1', 'Entreprise Démo', 'client@rfid.local', 100, 100, null, pw, now, now);
  } else {
    // Ensure demo account remains usable
    const row = db.prepare('SELECT password_hash FROM clients WHERE username = ?').get('client1');
    if (!row || !row.password_hash) {
      const pw = hashPassword('client1');
      db.prepare('UPDATE clients SET password_hash = ?, updated_at = ? WHERE username = ?').run(pw, now, 'client1');
    }
  }

  // Seed a default site for demo client
  try {
    const c1 = db.prepare('SELECT id FROM clients WHERE username = ?').get('client1');
    if (c1 && c1.id) {
      const s = db.prepare('SELECT id FROM sites WHERE client_id = ? AND name = ?').get(c1.id, 'Site 1');
      if (!s) {
        db.prepare('INSERT INTO sites (client_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run(c1.id, 'Site 1', now, now);
      }
    }
  } catch (_) {
    // ignore
  }
}

function withDb(fn) {
  // Ensure the DB directory exists. In packaged Electron builds, __dirname can be inside app.asar
  // and is not writable, so we must not blindly mkdir the legacy DATA_DIR.
  const dbDir = path.dirname(DB_PATH);
  if (dbDir && !fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const db = new Database(DB_PATH);
  try {
    ensureDbInitialized(db);
    return fn(db);
  } finally {
    try { db.close(); } catch (_) {}
  }
}

module.exports = {
  DB_PATH,
  withDb
};
