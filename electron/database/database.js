const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

let db;

function getDatabasePath() {
  const dirPath = path.join(app.getPath('appData'), 'PPC');
  fs.mkdirSync(dirPath, { recursive: true });
  return path.join(dirPath, 'propass.db');
}

function initDatabase() {
  const dbPath = getDatabasePath();
  db = new Database(dbPath);
  
  // Table sites
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Table clients
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'client',
      email TEXT,
      site_id INTEGER,
      monthly_limit INTEGER DEFAULT 15,
      valid_from TEXT,
      valid_to TEXT,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (site_id) REFERENCES sites(id)
    )
  `);
  
  // Table dumps
  db.exec(`
    CREATE TABLE IF NOT EXISTS dumps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      hex_data TEXT NOT NULL,
      uid TEXT,
      is_active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Table copy_log
  db.exec(`
    CREATE TABLE IF NOT EXISTS copy_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      uid_cloned TEXT,
      source_uid TEXT,
      status TEXT DEFAULT 'success',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Seed data
  const insertSite = db.prepare('INSERT OR IGNORE INTO sites (id, name) VALUES (?, ?)');
  insertSite.run(1, 'Default');

  // Cleanup: remove legacy/test sites so admin UI doesn't show them
  const legacySiteIds = db
    .prepare("SELECT id FROM sites WHERE name IN ('Site 1', 'Site Test')")
    .all()
    .map((r) => r.id);

  if (legacySiteIds.length > 0) {
    const placeholders = legacySiteIds.map(() => '?').join(',');
    db.prepare(`UPDATE clients SET site_id = 1 WHERE site_id IN (${placeholders})`).run(...legacySiteIds);
    db.prepare(`DELETE FROM sites WHERE id IN (${placeholders})`).run(...legacySiteIds);
  }
  
  const insertClient = db.prepare(`
    INSERT OR IGNORE INTO clients (id, username, password, display_name, role, email, site_id, monthly_limit, valid_from, valid_to, is_active) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertClient.run(1, 'admin', 'admin123', 'Administrateur', 'admin', 'admin@rfid.local', 1, 9999, '2025-01-01', '2030-12-31', 1);
  insertClient.run(2, 'client1', 'password', 'Client Démo', 'client', 'client@rfid.local', 1, 15, '2025-03-10', '2025-03-13', 1);

  // Seed copy_log (for dashboard preview)
  const hasCopyLog = db.prepare('SELECT 1 FROM copy_log LIMIT 1').get();
  if (!hasCopyLog) {
    db.prepare(
      'INSERT INTO copy_log (client_id, uid_cloned, source_uid, status) VALUES (?, ?, ?, ?)'
    ).run(2, '54C263EF', '54C263EF', 'success');
  }
  
  console.log('Database initialized at:', dbPath);
  return true;
}

function getDb() {
  return db;
}

module.exports = { initDatabase, getDb };
