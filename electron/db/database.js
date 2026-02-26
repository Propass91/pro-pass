const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3');

const DEFAULT_VALIDITY_DAYS = 30;

function getDatabasePath() {
  // Single portable DB name
  const fileName = 'database.db';

  // Prefer userData for write-permissions in installed builds
  try {
    const userDataDir = app.getPath('userData');
    if (userDataDir) return path.join(userDataDir, fileName);
  } catch (_) {
    // ignore
  }

  // Fallback to app folder (portable/unpacked)
  return path.join(process.cwd(), fileName);
}

function ensureDatabaseInitialized(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      client_username TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      name TEXT,
      email TEXT,
      quota_remaining INTEGER NOT NULL DEFAULT 0,
      monthly_limit INTEGER NOT NULL DEFAULT 15,
      valid_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS master_dumps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      uid TEXT,
      dump_hex TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
  `);

  // Seed a default client for the current UI
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM clients WHERE username = ?').get('client1');
  if (!existing) {
    db.prepare(
      'INSERT INTO clients (username, name, email, quota_remaining, monthly_limit, valid_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('client1', 'Entreprise Démo', 'client@rfid.local', 14, 15, null, now, now);
  }

  // Seed default auth users
  try {
    const usersCount = db.prepare('SELECT COUNT(1) AS c FROM users').get();
    if (usersCount && Number(usersCount.c || 0) === 0) {
      db.prepare('INSERT OR IGNORE INTO users (username, password, role, client_username, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('admin', 'admin123', 'admin', null, now);
    }
  } catch (_) {
    // ignore
  }

  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!admin) {
    db.prepare('INSERT OR IGNORE INTO users (username, password, role, client_username, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('admin', 'admin123', 'admin', null, now);
  } else {
    // Keep local admin usable for test access.
    db.prepare('UPDATE users SET password = ? WHERE username = ?').run('admin123', 'admin');
  }
  const clientUser = db.prepare('SELECT id FROM users WHERE username = ?').get('client1');
  if (!clientUser) {
    db.prepare('INSERT INTO users (username, password, role, client_username, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('client1', 'client1', 'client', 'client1', now);
  }
}

function withDb(fn) {
  const dbPath = getDatabasePath();
  const dir = path.dirname(dbPath);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    // ignore
  }

  const db = new Database(dbPath);
  try {
    ensureDatabaseInitialized(db);
    return fn(db, dbPath);
  } finally {
    try {
      db.close();
    } catch (_) {
      // ignore
    }
  }
}

function computeValidUntil(days = DEFAULT_VALIDITY_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || DEFAULT_VALIDITY_DAYS));
  return d.toISOString();
}

function getClients() {
  return withDb((db) => db.prepare('SELECT * FROM clients ORDER BY id').all());
}

function getClientById(clientId) {
  return withDb((db) => db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(clientId)));
}

function getClientByUsername(username) {
  return withDb((db) => db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username)));
}

function updateClientQuotaAndValidity(clientId, addQuota, validityDays = DEFAULT_VALIDITY_DAYS) {
  const now = new Date().toISOString();
  const validUntil = computeValidUntil(validityDays);
  return withDb((db) => {
    const id = Number(clientId);
    const delta = Number(addQuota || 0);
    db.prepare(
      'UPDATE clients SET quota_remaining = MAX(quota_remaining + ?, 0), valid_until = ?, updated_at = ? WHERE id = ?'
    ).run(delta, validUntil, now, id);
    return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  });
}

function decrementQuotaByUsername(username) {
  const now = new Date().toISOString();
  const user = String(username || 'client1');
  return withDb((db) => {
    db.prepare(
      'UPDATE clients SET quota_remaining = CASE WHEN quota_remaining > 0 THEN quota_remaining - 1 ELSE 0 END, updated_at = ? WHERE username = ?'
    ).run(now, user);
    return db.prepare('SELECT * FROM clients WHERE username = ?').get(user);
  });
}

function insertMasterDump(clientId, uid, dumpHex, validityDays = DEFAULT_VALIDITY_DAYS) {
  const now = new Date().toISOString();
  const validUntil = computeValidUntil(validityDays);
  return withDb((db) => {
    const id = Number(clientId);
    const info = db
      .prepare('INSERT INTO master_dumps (client_id, uid, dump_hex, created_at) VALUES (?, ?, ?, ?)')
      .run(id, uid || null, String(dumpHex), now);

    db.prepare('UPDATE clients SET valid_until = ?, updated_at = ? WHERE id = ?').run(validUntil, now, id);

    const dumpRow = db.prepare('SELECT * FROM master_dumps WHERE id = ?').get(info.lastInsertRowid);
    const clientRow = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    return { dump: dumpRow, client: clientRow };
  });
}

function getLatestMasterDumpForClient(clientId) {
  return withDb((db) =>
    db
      .prepare('SELECT * FROM master_dumps WHERE client_id = ? ORDER BY id DESC LIMIT 1')
      .get(Number(clientId))
  );
}

module.exports = {
  DEFAULT_VALIDITY_DAYS,
  getDatabasePath,
  getClients,
  getClientById,
  getClientByUsername,
  updateClientQuotaAndValidity,
  decrementQuotaByUsername,
  insertMasterDump,
  getLatestMasterDumpForClient
  ,
  // auth
  authenticateUser: (username, password) => withDb((db) => {
    return db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(String(username || ''), String(password || ''));
  }),
  getClientForUser: (userRow) => {
    if (!userRow) return null;
    if (userRow.role === 'client') {
      return getClientByUsername(userRow.client_username || userRow.username);
    }
    return null;
  }
};
