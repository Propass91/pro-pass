const path = require('path');
const fs = require('fs');
let dotenv = null;
try {
  dotenv = require('dotenv');
} catch (_) {
  dotenv = null;
}

// Load root .env (preferred) then allow cloud/.env to override if someone uses it.
// In packaged builds, dotenv may not be present; in that case we simply skip.
if (!String(process.env.PROPASS_SKIP_DOTENV || '').trim() && dotenv && typeof dotenv.config === 'function') {
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
  dotenv.config({ path: path.join(__dirname, '.env') });
}

const express = require('express');
const cors = require('cors');
const http = require('http');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const { withDb } = require('./db');
const { hashPassword, verifyPassword, newToken } = require('./auth');
const { sendPasswordResetEmail, sendInvitationEmail } = require('./mail');

const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev_admin_key_change_me';
const DEFAULT_VALIDITY_DAYS = 30;

function getPublicBaseUrl(req) {
  const explicit = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (explicit) return explicit;

  // Works behind reverse proxies (nginx/caddy) that set X-Forwarded-* headers.
  const xfProtoRaw = (req && req.headers && req.headers['x-forwarded-proto']) || '';
  const xfHostRaw = (req && req.headers && req.headers['x-forwarded-host']) || '';
  const xfProto = String(xfProtoRaw).split(',')[0].trim();
  const xfHost = String(xfHostRaw).split(',')[0].trim();

  const host = xfHost || String((req && req.headers && req.headers.host) || '').trim();
  const proto = xfProto || 'http';

  if (host) return `${proto}://${host}`;
  return `http://localhost:${PORT}`;
}

function computeValidUntil(days = DEFAULT_VALIDITY_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || DEFAULT_VALIDITY_DAYS));
  return d.toISOString();
}

function signUserJwt({ id, username, role }) {
  return jwt.sign(
    { sub: String(id), username: String(username), role: String(role || 'client') },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function authMiddleware(req, res, next) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'missing_token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.clientAuth = payload;
    next();
  } catch (_) {
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }
}

function adminMiddleware(req, res, next) {
  // Accept either a static API key (for headless admin tools) OR a Bearer JWT with role=admin.
  const key = String(req.headers['x-admin-key'] || '');
  if (key && key === String(ADMIN_API_KEY)) return next();

  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
  if (!token) return res.status(403).json({ ok: false, error: 'admin_forbidden' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload && payload.role === 'admin') {
      req.adminAuth = payload;
      return next();
    }
  } catch (_) {
    // ignore
  }
  return res.status(403).json({ ok: false, error: 'admin_forbidden' });
}

function clientOnly(req, res, next) {
  if (req.clientAuth && req.clientAuth.role === 'client') return next();
  return res.status(403).json({ ok: false, error: 'client_only' });
}

// --- App ---
const app = express();
// Required in production behind a reverse proxy (Nginx/Caddy/Cloudflare)
// so Express can rely on X-Forwarded-* headers.
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Route de santé ultra-robuste
app.get('/health', (req, res) => {
  try {
    res.status(200).json({ 
      status: 'OK', 
      uptime: process.uptime(),
      timestamp: Date.now() 
    });
  } catch (error) {
    console.error("Healthcheck Error:", error);
    res.status(500).json({ status: 'FAIL', error: error.message });
  }
});

function firstHeaderValue(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  // X-Forwarded-* can be a comma-separated list.
  return s.split(',')[0].trim();
}

function safeHost(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Remove anything after whitespace
  const token = s.split(/\s+/)[0];
  // Very small allow-list: host[:port] or [ipv6]:port
  const cleaned = token.replace(/[^0-9a-zA-Z.\-:\[\]]/g, '');
  return cleaned;
}

function safeProto(raw) {
  const p = String(raw || '').trim().toLowerCase();
  if (p === 'https') return 'https';
  if (p === 'http') return 'http';
  return '';
}

function getPublicBaseUrl(req) {
  const explicit = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (explicit && /^https?:\/\//i.test(explicit)) {
    return explicit.replace(/\/$/, '');
  }

  const xfProto = safeProto(firstHeaderValue(req && req.headers && req.headers['x-forwarded-proto']));
  const xfHost = safeHost(firstHeaderValue(req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)));

  const proto = xfProto || safeProto((req && req.protocol) || '') || 'http';
  const host = xfHost || `localhost:${PORT}`;

  return `${proto}://${host}`.replace(/\/$/, '');
}

function findLatestInstallerExe() {
  const distDir = path.join(__dirname, '..', 'dist');
  try {
    if (!fs.existsSync(distDir)) return null;
    const files = fs.readdirSync(distDir);
    const exeFiles = files
      .filter((name) => typeof name === 'string')
      .filter((name) => name.toLowerCase().endsWith('.exe'))
      .filter((name) => !name.toLowerCase().endsWith('.exe.blockmap'))
      .map((name) => {
        const fullPath = path.join(distDir, name);
        let stat = null;
        try { stat = fs.statSync(fullPath); } catch (_) { stat = null; }
        return { name, fullPath, mtimeMs: stat ? Number(stat.mtimeMs || 0) : 0, size: stat ? Number(stat.size || 0) : 0 };
      })
      .filter((x) => x && x.size > 0);

    if (!exeFiles.length) return null;
    exeFiles.sort((a, b) => (b.mtimeMs - a.mtimeMs));
    return exeFiles[0];
  } catch (_) {
    return null;
  }
}

function sendInstallerFile(req, res, { filePath, downloadName }) {
  const stat = fs.statSync(filePath);
  const size = Number(stat.size || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return res.status(404).json({ ok: false, error: 'installer_missing' });
  }

  // Headers required for reliable browser downloads + resume.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${String(downloadName).replace(/"/g, '')}"`);
  res.setHeader('Accept-Ranges', 'bytes');

  const rangeHeader = String(req.headers.range || '').trim();

  // HEAD: only headers.
  if (String(req.method || 'GET').toUpperCase() === 'HEAD') {
    res.setHeader('Content-Length', String(size));
    return res.status(200).end();
  }

  // No range: full file.
  if (!rangeHeader) {
    res.setHeader('Content-Length', String(size));
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      try { res.status(500).end(); } catch (_) {}
    });
    return stream.pipe(res);
  }

  // Range: bytes=start-end
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);
  if (!m) {
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.status(416).end();
  }

  let start = m[1] ? Number(m[1]) : NaN;
  let end = m[2] ? Number(m[2]) : NaN;

  if (Number.isNaN(start) && !Number.isNaN(end)) {
    // suffix range: bytes=-N
    const suffixLen = Math.max(0, Math.min(size, end));
    start = Math.max(0, size - suffixLen);
    end = size - 1;
  } else {
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
  }

  if (start < 0 || end < start || start >= size) {
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.status(416).end();
  }

  const chunkSize = (end - start) + 1;
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', String(chunkSize));

  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => {
    try { res.status(500).end(); } catch (_) {}
  });
  return stream.pipe(res);
}

function handleDownload(req, res) {
  const publicDl = String(process.env.PUBLIC_DOWNLOAD_URL || '').trim();
  const isDirectPublicDl =
    /^https?:\/\//i.test(publicDl) &&
    (publicDl.toLowerCase().endsWith('.exe') || publicDl.toLowerCase().includes('/download'));
  if (publicDl && isDirectPublicDl) {
    // Avoid redirect loops when someone mistakenly points PUBLIC_DOWNLOAD_URL
    // to this same server (e.g. https://domain/download or /download/propass).
    try {
      const u = new URL(publicDl);
      const curHost = safeHost(firstHeaderValue(req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)));
      const sameHost = curHost && String(u.host || '').toLowerCase() === String(curHost).toLowerCase();
      const isDownloadPath = String(u.pathname || '').toLowerCase().startsWith('/download');
      if (!(sameHost && isDownloadPath)) {
        return res.redirect(302, publicDl);
      }
    } catch (_) {
      // If parsing fails, don't redirect.
    }
  }

  const fileEnv = String(process.env.DOWNLOAD_FILE || process.env.PUBLIC_DOWNLOAD_FILE || '').trim();
  let chosenPath = null;
  let chosenName = null;

  if (fileEnv) {
    const resolved = path.isAbsolute(fileEnv) ? fileEnv : path.join(__dirname, '..', fileEnv);
    try {
      if (fs.existsSync(resolved)) {
        chosenPath = resolved;
        chosenName = path.basename(resolved);
      }
    } catch (_) {}
  }

  if (!chosenPath) {
    const latest = findLatestInstallerExe();
    if (latest && latest.fullPath) {
      chosenPath = latest.fullPath;
      chosenName = latest.name;
    }
  }

  if (chosenPath) {
    const friendly = String(process.env.DOWNLOAD_NAME || process.env.PUBLIC_DOWNLOAD_NAME || '').trim();
    const downloadName = friendly || chosenName || 'PROPASS-Setup.exe';
    return sendInstallerFile(req, res, { filePath: chosenPath, downloadName });
  }

  // Friendly HTML for browsers, JSON for API callers
  const accept = String(req.headers.accept || '');
  if (accept.includes('text/html')) {
    return res.status(404).send('<!doctype html><html><body style="font-family:system-ui; padding:24px;"><h3>Téléchargement indisponible</h3><p>Aucun installateur trouvé. Générez un build (dossier <code>dist/</code>) ou configurez <code>PUBLIC_DOWNLOAD_URL</code>.</p></body></html>');
  }
  return res.status(404).json({ ok: false, error: 'download_not_configured' });
}

// --- Public: download the installer ---
app.get('/download', handleDownload);
app.head('/download', handleDownload);

// Backwards/explicit route for emails/docs
app.get('/download/propass', handleDownload);
app.head('/download/propass', handleDownload);

// --- Client login (online verification each session) ---
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'missing_credentials' });

  const out = withDb((db) => {
    // Admin login
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username));
    if (admin && admin.password_hash && verifyPassword(String(password), String(admin.password_hash))) {
      const token = signUserJwt({ id: admin.id, username: admin.username, role: 'admin' });
      return { ok: true, token, role: 'admin', user: { id: admin.id, username: admin.username } };
    }

    // Client login
    const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client || !client.password_hash) return { ok: false, error: 'invalid_credentials' };
    if (!verifyPassword(String(password), String(client.password_hash))) return { ok: false, error: 'invalid_credentials' };
    const token = signUserJwt({ id: client.id, username: client.username, role: 'client' });
    return { ok: true, token, role: 'client', client: { id: client.id, username: client.username, name: client.name, email: client.email } };
  });

  if (!out.ok) return res.status(401).json(out);
  return res.json(out);
});

// --- Quota read ---
app.get('/client/quota', authMiddleware, clientOnly, (req, res) => {
  const username = req.clientAuth && req.clientAuth.username;
  const out = withDb((db) => {
    const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client) return { ok: false, error: 'not_found' };
    const monthlyLimit = Math.max(1, Number(client.monthly_limit || 100));
    const remainingRaw = Number(client.quota_remaining || 0);
    const remaining = Math.max(0, Math.min(monthlyLimit, remainingRaw));
    const used = Math.max(0, monthlyLimit - remaining);
    return {
      ok: true,
      quota: {
        remaining,
        monthly_limit: monthlyLimit,
        copies_this_month: used,
        valid_until: client.valid_until
      }
    };
  });
  if (!out.ok) return res.status(404).json(out);
  return res.json(out);
});

// --- Quota decrement (used when a copy is performed) ---
app.post('/client/quota/decrement', authMiddleware, clientOnly, (req, res) => {
  const username = req.clientAuth && req.clientAuth.username;
  const now = new Date().toISOString();
  const ts = Date.now();

  const out = withDb((db) => {
    const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client) return { ok: false, error: 'not_found' };
    const remaining = Math.max(0, Number(client.quota_remaining || 0) - 1);
    db.prepare('UPDATE clients SET quota_remaining = ?, updated_at = ? WHERE id = ?').run(remaining, now, client.id);

    // Log a successful copy (server-side)
    try {
      const companyName = String(client.company_name || client.name || client.username || '—');
      db.prepare('INSERT INTO copy_logs (client_id, company_name, action, ts, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(client.id, companyName, 'Copié', ts, now);
    } catch (_) {}

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
    return { ok: true, quota: { remaining: updated.quota_remaining, monthly_limit: updated.monthly_limit, valid_until: updated.valid_until } };
  });

  if (!out.ok) return res.status(404).json(out);
  broadcastQuotaUpdate({ username: String(username), quota_remaining: out.quota.remaining, monthly_limit: out.quota.monthly_limit, valid_until: out.quota.valid_until });
  return res.json(out);
});

// --- Client: log a failed copy (so admin Logs can show "Échec copie") ---
app.post('/client/copy-log/fail', authMiddleware, clientOnly, (req, res) => {
  const username = req.clientAuth && req.clientAuth.username;
  const now = new Date().toISOString();
  const ts = Date.now();

  const out = withDb((db) => {
    const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client) return { ok: false, error: 'not_found' };
    const companyName = String(client.company_name || client.name || client.username || '—');
    db.prepare('INSERT INTO copy_logs (client_id, company_name, action, ts, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(client.id, companyName, 'Échec copie', ts, now);
    return { ok: true };
  });

  if (!out.ok) return res.status(404).json(out);
  return res.json(out);
});

// --- Latest master dump for authenticated client ---
app.get('/client/master-dump/latest', authMiddleware, clientOnly, (req, res) => {
  const username = req.clientAuth && req.clientAuth.username;
  const out = withDb((db) => {
    const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client) return { ok: false, error: 'not_found' };
    const dump = db.prepare('SELECT * FROM master_dumps WHERE client_id = ? ORDER BY id DESC LIMIT 1').get(client.id);
    if (!dump) return { ok: false, error: 'no_master_dump' };
    return { ok: true, dump: { id: dump.id, uid: dump.uid, dump_hex: dump.dump_hex, created_at: dump.created_at } };
  });
  if (!out.ok) return res.status(404).json(out);
  return res.json(out);
});

// --- Client: get active dump to copy (global) ---
app.get('/client/dumps/active', authMiddleware, clientOnly, (req, res) => {
  const out = withDb((db) => {
    const row = db.prepare("SELECT * FROM dumps WHERE scope = 'global' AND is_active = 1 ORDER BY id DESC LIMIT 1").get();
    if (!row) return { ok: false, error: 'no_active_dump' };
    return { ok: true, dump: { id: row.id, uid: row.uid, dump_hex: row.dump_hex, source: row.source, created_at: row.created_at } };
  });
  if (!out.ok) return res.status(404).json(out);
  return res.json(out);
});

// --- Client: active dump (binary) for Electron sync ---
// Required by spec: GET /api/client/dump/active
// - Authorization: Bearer <jwt>
// - client-id: optional (not required; JWT identifies the client)
// - If-None-Match: <sha256> -> returns 304 when unchanged
app.get('/api/client/dump/active', authMiddleware, clientOnly, (req, res) => {
  const username = req.clientAuth && req.clientAuth.username;
  const out = withDb((db) => {
    // Preferred: global active dump
    const row = db.prepare("SELECT * FROM dumps WHERE scope = 'global' AND is_active = 1 ORDER BY id DESC LIMIT 1").get();
    if (row && row.dump_hex) {
      const hex = String(row.dump_hex || '');
      if (hex.length < 2048) return { ok: false, error: 'invalid_dump' };
      const bytes = Buffer.from(hex.slice(0, 2048), 'hex');
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      return { ok: true, bytes, hash, updated_at: row.updated_at || row.created_at || new Date().toISOString() };
    }

    // Fallback: client's latest master dump (works with admin "master dump" workflow)
    const client = db.prepare('SELECT id FROM clients WHERE username = ?').get(String(username || ''));
    if (!client || !client.id) return { ok: false, error: 'not_found' };
    const md = db.prepare('SELECT * FROM master_dumps WHERE client_id = ? ORDER BY id DESC LIMIT 1').get(client.id);
    if (!md || !md.dump_hex) return { ok: false, error: 'no_master_dump' };
    const hex = String(md.dump_hex || '');
    if (hex.length < 2048) return { ok: false, error: 'invalid_dump' };
    const bytes = Buffer.from(hex.slice(0, 2048), 'hex');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    return { ok: true, bytes, hash, updated_at: md.created_at || new Date().toISOString() };
  });

  if (!out.ok) return res.status(404).json(out);

  const inm = String(req.headers['if-none-match'] || '').replace(/\W/g, '');
  res.setHeader('ETag', out.hash);
  res.setHeader('X-Dump-Hash', out.hash);
  res.setHeader('X-Dump-Updated-At', String(out.updated_at || ''));

  if (inm && inm === out.hash) {
    return res.status(304).end();
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  return res.status(200).send(out.bytes);
});

function normalizeDumpHex(dumpHex) {
  const hex = String(dumpHex || '').trim().toLowerCase();
  if (!hex) return null;
  if (hex.length < 2048) return null;
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  return hex.slice(0, 2048);
}

// --- Client: upload a master dump (store on server) ---
// POST /api/client/master-dump
// Body: { dump_hex: <2048 hex chars>, uid?: string|null, siteId?: number|null }
app.post('/api/client/master-dump', authMiddleware, clientOnly, (req, res) => {
  const username = req.clientAuth && req.clientAuth.username;
  const { dump_hex, uid, siteId } = req.body || {};
  const dumpHex = normalizeDumpHex(dump_hex);
  if (!dumpHex) return res.status(400).json({ ok: false, error: 'invalid_dump' });

  const now = new Date().toISOString();

  const out = withDb((db) => {
    const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username || ''));
    if (!client) return { ok: false, error: 'client_not_found' };

    let resolvedSiteId = null;
    if (siteId != null) {
      const s = db.prepare('SELECT id FROM sites WHERE id = ? AND client_id = ?').get(Number(siteId), client.id);
      if (!s) return { ok: false, error: 'site_not_found' };
      resolvedSiteId = Number(s.id);
    }

    const info = db.prepare('INSERT INTO master_dumps (client_id, uid, dump_hex, source, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(client.id, uid || null, dumpHex, 'direct', now);

    try {
      if (resolvedSiteId != null) {
        db.prepare('UPDATE master_dumps SET site_id = ? WHERE id = ?').run(resolvedSiteId, info.lastInsertRowid);
      }
    } catch (_) {}

    return { ok: true, dump: { id: Number(info.lastInsertRowid), uid: uid || null, created_at: now } };
  });

  if (!out.ok) {
    const code = String(out.error || 'upload_failed');
    const status = code === 'client_not_found' ? 404 : 400;
    return res.status(status).json(out);
  }
  return res.json(out);
});

// --- Admin: create/update clients (optional) ---
app.post('/admin/client/set-password', adminMiddleware, (req, res) => {
  const { username, password, email, name } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'missing_fields' });
  const pw = hashPassword(String(password));
  const now = new Date().toISOString();

  const out = withDb((db) => {
    const existing = db.prepare('SELECT id FROM clients WHERE username = ?').get(String(username));
    if (existing) {
      db.prepare('UPDATE clients SET password_hash = ?, email = COALESCE(?, email), name = COALESCE(?, name), updated_at = ? WHERE username = ?')
        .run(pw, email || null, name || null, now, String(username));
    } else {
      db.prepare('INSERT INTO clients (username, name, email, quota_remaining, monthly_limit, valid_until, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(String(username), name || username, email || null, 0, 15, null, pw, now, now);
    }
    return db.prepare('SELECT id, username, name, email FROM clients WHERE username = ?').get(String(username));
  });

  res.json({ ok: true, client: out });
});

app.get('/admin/clients', adminMiddleware, (_req, res) => {
  const out = withDb((db) => {
    return db.prepare(`
      SELECT id, username, name, email,
             company_name, legal_form, sales_rep,
             contact_first_name, contact_last_name, contact_phone,
             is_active, contract_start,
             quota_remaining, monthly_limit, valid_until, created_at, updated_at
      FROM clients
      ORDER BY id
    `).all();
  });
  res.json({ ok: true, clients: out });
});

app.post('/admin/clients', adminMiddleware, (req, res) => {
  const body = req.body || {};
  const now = new Date().toISOString();

  const companyName = String(body.companyName || body.name || '').trim();
  const legalForm = String(body.legalForm || '').trim();
  const salesRep = String(body.salesRep || '').trim();
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const copiesTotal = Number(body.copiesTotal || 0);
  const contractStart = String(body.contractStart || '').trim();
  const validUntil = String(body.validUntil || '').trim();

  if (!companyName || !legalForm || !salesRep || !firstName || !lastName || !phone || !email || !copiesTotal || !contractStart || !validUntil) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }

  // Username strategy: email (simple + unique enough)
  const username = email.toLowerCase();
  const tempPassword = newToken(6);
  const pwHash = hashPassword(tempPassword);

  const out = withDb((db) => {
    const existing = db.prepare('SELECT id FROM clients WHERE username = ?').get(username);
    if (existing) return { ok: false, error: 'username_exists' };

    db.prepare(`
      INSERT INTO clients (
        username, name, email,
        company_name, legal_form, sales_rep,
        contact_first_name, contact_last_name, contact_phone,
        is_active, contract_start,
        quota_remaining, monthly_limit, valid_until,
        password_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      username,
      companyName,
      email,
      companyName,
      legalForm,
      salesRep,
      firstName,
      lastName,
      phone,
      contractStart,
      Math.max(0, copiesTotal),
      Math.max(1, copiesTotal),
      validUntil,
      pwHash,
      now,
      now
    );

    const row = db.prepare('SELECT * FROM clients WHERE username = ?').get(username);
    return { ok: true, client: row, tempPassword };
  });

  if (!out.ok) return res.status(400).json(out);
  return res.json(out);
});

app.patch('/admin/clients/:id', adminMiddleware, (req, res) => {
  const id = Number(req.params && req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });

  const body = req.body || {};
  const now = new Date().toISOString();

  const companyName = String(body.companyName || body.name || '').trim();
  const legalForm = String(body.legalForm || '').trim();
  const salesRep = String(body.salesRep || '').trim();
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const copiesTotal = Number(body.copiesTotal || 0);
  const contractStart = String(body.contractStart || '').trim();
  const validUntil = String(body.validUntil || '').trim();

  if (!companyName || !legalForm || !salesRep || !firstName || !lastName || !phone || !email || !copiesTotal || !contractStart || !validUntil) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }

  const out = withDb((db) => {
    const cur = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!cur) return { ok: false, error: 'not_found' };

    db.prepare(`
      UPDATE clients SET
        name = ?,
        email = ?,
        company_name = ?,
        legal_form = ?,
        sales_rep = ?,
        contact_first_name = ?,
        contact_last_name = ?,
        contact_phone = ?,
        contract_start = ?,
        monthly_limit = ?,
        quota_remaining = MIN(quota_remaining, ?),
        valid_until = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      companyName,
      email,
      companyName,
      legalForm,
      salesRep,
      firstName,
      lastName,
      phone,
      contractStart,
      Math.max(1, copiesTotal),
      Math.max(0, copiesTotal),
      validUntil,
      now,
      id
    );

    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    return { ok: true, client: row };
  });

  if (!out.ok) return res.status(404).json(out);
  return res.json(out);
});

app.post('/admin/clients/:id/toggle', adminMiddleware, (req, res) => {
  const id = Number(req.params && req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });
  const now = new Date().toISOString();

  const out = withDb((db) => {
    const cur = db.prepare('SELECT id, is_active FROM clients WHERE id = ?').get(id);
    if (!cur) return { ok: false, error: 'not_found' };
    const next = Number(cur.is_active || 0) ? 0 : 1;
    db.prepare('UPDATE clients SET is_active = ?, updated_at = ? WHERE id = ?').run(next, now, id);
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    return { ok: true, client: row };
  });

  if (!out.ok) return res.status(404).json(out);
  return res.json(out);
});

app.post('/admin/clients/:id/send-invite', adminMiddleware, async (req, res) => {
  const id = Number(req.params && req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });

  const out = withDb((db) => {
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!row) return { ok: false, error: 'not_found' };
    if (!row.email) return { ok: false, error: 'missing_email' };

    // Generate a one-shot password setup/reset link (no password sent by email)
    const token = newToken(24);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO password_resets (client_id, token, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)')
      .run(row.id, token, expiresAt, createdAt);

    return { ok: true, client: row, token, expiresAt };
  });

  if (!out.ok) return res.status(404).json(out);

  const downloadEnv = String(process.env.PUBLIC_DOWNLOAD_URL || '').trim();
  const base = getPublicBaseUrl(req);
  const looksLikeDirectLink =
    !!downloadEnv &&
    (/^https?:\/\//i.test(downloadEnv) && (downloadEnv.toLowerCase().endsWith('.exe') || downloadEnv.toLowerCase().includes('/download')));
  const downloadUrl = looksLikeDirectLink
    ? downloadEnv
    : String((downloadEnv || base)).replace(/\/$/, '') + '/download';
  const resetUrl = `${String(base).replace(/\/$/, '')}/reset?token=${out.token}`;

  try {
    await sendInvitationEmail({
      to: out.client.email,
      downloadUrl,
      username: String(out.client.username),
      resetUrl
    });
    return res.json({ ok: true, sent: true, resetUrl, downloadUrl, expiresAt: out.expiresAt, expires_at: out.expiresAt });
  } catch (e) {
    return res.json({ ok: true, sent: false, resetUrl, downloadUrl, expiresAt: out.expiresAt, expires_at: out.expiresAt, error: String(e && e.message || e) });
  }
});

// --- Admin: create a one-time password reset link (no email) ---
// Use when you want to send the onboarding email manually (Gmail) without exposing a password.
// Auth: x-admin-key OR Bearer admin JWT.
app.post('/admin/create-reset-link', adminMiddleware, (req, res) => {
  const { clientId, username, validity_days, expiresMinutes } = req.body || {};
  const u = String(username || '').trim();
  if (clientId == null && !u) return res.status(400).json({ ok: false, error: 'missing_fields' });

  const createdAt = new Date().toISOString();
  let expiresAt = null;

  if (validity_days != null) {
    const daysRaw = Number(validity_days);
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(30, daysRaw)) : 7;
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  } else {
    const minutesRaw = Number(expiresMinutes == null ? 60 : expiresMinutes);
    const minutes = Number.isFinite(minutesRaw) ? Math.max(5, Math.min(24 * 60, minutesRaw)) : 60;
    expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }

  const out = withDb((db) => {
    let client = null;
    if (clientId != null) client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(clientId));
    if (!client && u) client = db.prepare('SELECT * FROM clients WHERE username = ?').get(u);
    if (!client) return { ok: false, error: 'not_found' };
    const token = newToken(24);
    db.prepare('INSERT INTO password_resets (client_id, token, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)')
      .run(client.id, token, expiresAt, createdAt);
    return { ok: true, token, expiresAt, client: { id: client.id, username: client.username, email: client.email || null } };
  });

  if (!out.ok) return res.status(404).json(out);

  const base = getPublicBaseUrl(req);
  const resetUrl = `${String(base).replace(/\/$/, '')}/reset?token=${out.token}`;
  return res.json({ ok: true, resetUrl, expiresAt: out.expiresAt, expires_at: out.expiresAt, client: out.client });
});

// --- Admin: stats for dashboard ---
app.get('/admin/stats', adminMiddleware, (_req, res) => {
  const out = withDb((db) => {
    const totalClientsRow = db.prepare('SELECT COUNT(1) AS c FROM clients').get();
    const totalCopiesRow = db.prepare("SELECT COUNT(1) AS c FROM copy_events WHERE status = 'success'").get();
    return {
      ok: true,
      stats: {
        totalClients: Number(totalClientsRow && totalClientsRow.c || 0),
        totalCopies: Number(totalCopiesRow && totalCopiesRow.c || 0)
      }
    };
  });
  return res.json(out);
});

// --- Admin: ingest copy events (success/fail) ---
app.post('/admin/copy-events/bulk', adminMiddleware, (req, res) => {
  const events = (req.body && req.body.events) || [];
  if (!Array.isArray(events)) return res.status(400).json({ ok: false, error: 'invalid_events' });

  const out = withDb((db) => {
    const stmt = db.prepare('INSERT OR IGNORE INTO copy_events (event_key, ts, status, source, created_at) VALUES (?, ?, ?, ?, ?)');
    let inserted = 0;
    for (const ev of events) {
      const key = ev && ev.key != null ? String(ev.key) : null;
      const ts = Number(ev && ev.ts);
      if (!Number.isFinite(ts)) continue;
      const rawStatus = String(ev && ev.status || '').toLowerCase();
      const status = rawStatus === 'fail' ? 'fail' : 'success';
      const source = ev && ev.source != null ? String(ev.source) : 'ui';
      const createdAt = new Date(ts).toISOString();
      const info = stmt.run(key, Math.trunc(ts), status, source, createdAt);
      if (info && info.changes) inserted += info.changes;
    }
    return { ok: true, inserted };
  });

  return res.json(out);
});

// --- Admin: copy stats for chart ---
app.get('/admin/copy-stats', adminMiddleware, (req, res) => {
  const period = String((req.query && req.query.period) || 'monthly').toLowerCase();
  const mode = period === 'weekly' ? 'weekly' : 'monthly';

  const out = withDb((db) => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const buckets = [];
    if (mode === 'weekly') {
      // last 7 days including today
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        buckets.push({
          key: `${d.getFullYear()}-${mm}-${dd}`,
          label: `${dd}/${mm}`,
          start: d.getTime(),
          end: d.getTime() + 86400000
        });
      }
    } else {
      // last 12 months including current
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      start.setMonth(start.getMonth() - 11);
      for (let i = 0; i < 12; i++) {
        const m = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
        const mm = String(m.getMonth() + 1).padStart(2, '0');
        buckets.push({
          key: `${m.getFullYear()}-${mm}`,
          label: `${mm}/${m.getFullYear()}`,
          start: m.getTime(),
          end: next.getTime()
        });
      }
    }

    const minTs = buckets.length ? buckets[0].start : 0;
    const rows = db.prepare('SELECT ts, status FROM copy_events WHERE ts >= ? ORDER BY ts ASC').all(minTs);

    const success = Array.from({ length: buckets.length }, () => 0);
    const fail = Array.from({ length: buckets.length }, () => 0);

    for (const r of rows) {
      const ts = Number(r && r.ts);
      if (!Number.isFinite(ts)) continue;
      let idx = -1;
      // linear scan (buckets small)
      for (let i = 0; i < buckets.length; i++) {
        if (ts >= buckets[i].start && ts < buckets[i].end) { idx = i; break; }
      }
      if (idx < 0) continue;
      if (String(r.status) === 'fail') fail[idx] += 1;
      else success[idx] += 1;
    }

    return {
      ok: true,
      period: mode,
      labels: buckets.map((b) => b.label),
      success,
      fail
    };
  });

  return res.json(out);
});

// --- Admin: Logs with server-side pagination (lazy loading) ---
app.get('/admin/logs', adminMiddleware, (req, res) => {
  const societe = String((req.query && req.query.societe) || '').trim();
  const action = String((req.query && req.query.action) || 'Tous').trim();
  const dateDebut = String((req.query && req.query.dateDebut) || '').trim();
  const dateFin = String((req.query && req.query.dateFin) || '').trim();
  const page = Math.max(1, Number((req.query && req.query.page) || 1));
  const limit = Math.min(200, Math.max(1, Number((req.query && req.query.limit) || 10)));

  const out = withDb((db) => {
    const where = [];
    const args = [];

    if (societe) {
      where.push('LOWER(company_name) LIKE ?');
      args.push(`%${societe.toLowerCase()}%`);
    }

    if (action && action !== 'Tous') {
      if (action === 'Copié') {
        where.push('action = ?');
        args.push('Copié');
      } else if (action === 'Échec copie' || action === 'Echec copie') {
        where.push('action = ?');
        args.push('Échec copie');
      }
    }

    const toTs = (d, end = false) => {
      if (!d) return null;
      const x = new Date(d);
      if (Number.isNaN(x.getTime())) return null;
      if (end) x.setHours(23, 59, 59, 999);
      else x.setHours(0, 0, 0, 0);
      return x.getTime();
    };

    const tsStart = toTs(dateDebut, false);
    const tsEnd = toTs(dateFin, true);
    if (tsStart != null) {
      where.push('ts >= ?');
      args.push(tsStart);
    }
    if (tsEnd != null) {
      where.push('ts <= ?');
      args.push(tsEnd);
    }

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const totalRow = db.prepare(`SELECT COUNT(1) AS c FROM copy_logs ${whereSql}`).get(...args);
    const total = Number(totalRow && totalRow.c || 0);
    const pageCount = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pageCount);
    const offset = (safePage - 1) * limit;

    const rows = db.prepare(`
      SELECT id, company_name, action, ts
      FROM copy_logs
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...args, limit, offset);

    return { ok: true, page: safePage, limit, total, pageCount, rows };
  });

  return res.json(out);
});

app.post('/admin/client/add-quota', adminMiddleware, (req, res) => {
  const { clientId, username, addQuota, validity_days } = req.body || {};
  const now = new Date().toISOString();
  const validUntil = computeValidUntil(Number(validity_days || DEFAULT_VALIDITY_DAYS));
  const delta = Number(addQuota || 0);

  const out = withDb((db) => {
    let client = null;
    if (clientId != null) client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(clientId));
    if (!client && username) client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client) return null;

    const newRemaining = Math.max(0, Number(client.quota_remaining || 0) + delta);
    db.prepare('UPDATE clients SET quota_remaining = ?, valid_until = ?, updated_at = ? WHERE id = ?')
      .run(newRemaining, validUntil, now, client.id);
    return db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
  });

  if (!out) return res.status(404).json({ ok: false, error: 'not_found' });
  broadcastQuotaUpdate({ username: out.username, quota_remaining: out.quota_remaining, monthly_limit: out.monthly_limit, valid_until: out.valid_until });
  res.json({ ok: true, client: out });
});

app.post('/admin/client/quota', adminMiddleware, (req, res) => {
  const { username, quota_remaining, monthly_limit, validity_days } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, error: 'missing_username' });

  const now = new Date().toISOString();
  const validUntil = computeValidUntil(Number(validity_days || DEFAULT_VALIDITY_DAYS));

  const out = withDb((db) => {
    const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client) return null;
    const q = quota_remaining == null ? Number(client.quota_remaining || 0) : Number(quota_remaining);
    const ml = monthly_limit == null ? Number(client.monthly_limit || 15) : Number(monthly_limit);
    db.prepare('UPDATE clients SET quota_remaining = ?, monthly_limit = ?, valid_until = ?, updated_at = ? WHERE username = ?')
      .run(Math.max(0, q), Math.max(1, ml), validUntil, now, String(username));
    return db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
  });

  if (!out) return res.status(404).json({ ok: false, error: 'not_found' });

  broadcastQuotaUpdate({ username: out.username, quota_remaining: out.quota_remaining, monthly_limit: out.monthly_limit, valid_until: out.valid_until });
  res.json({ ok: true, client: out });
});

// --- Admin: master dump upsert ---
app.post('/admin/master-dump', adminMiddleware, (req, res) => {
  const { clientId, username, dump_hex, uid, source, siteId } = req.body || {};
  if ((!username && clientId == null) || !dump_hex) return res.status(400).json({ ok: false, error: 'missing_fields' });
  const now = new Date().toISOString();
  const validUntil = computeValidUntil(DEFAULT_VALIDITY_DAYS);
  const src = (source === 'manual' || source === 'direct') ? source : 'manual';

  const out = withDb((db) => {
    let client = null;
    if (clientId != null) client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(clientId));
    if (!client && username) client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client) return { ok: false, error: 'client_not_found' };

    let resolvedSiteId = null;
    if (siteId != null) {
      const s = db.prepare('SELECT id FROM sites WHERE id = ? AND client_id = ?').get(Number(siteId), client.id);
      if (!s) return { ok: false, error: 'site_not_found' };
      resolvedSiteId = Number(s.id);
    }
    db.prepare('INSERT INTO master_dumps (client_id, uid, dump_hex, source, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(client.id, uid || null, String(dump_hex), src, now);

    // If the DB has the migrated column, also set site_id (ignore errors on older rows)
    try {
      if (resolvedSiteId != null) {
        db.prepare('UPDATE master_dumps SET site_id = ? WHERE id = (SELECT id FROM master_dumps WHERE client_id = ? ORDER BY id DESC LIMIT 1)')
          .run(resolvedSiteId, client.id);
      }
    } catch (_) {}

    db.prepare('UPDATE clients SET valid_until = ?, updated_at = ? WHERE id = ?').run(validUntil, now, client.id);

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
    return { ok: true, client: updated };
  });

  if (!out.ok) return res.status(404).json(out);
  broadcastQuotaUpdate({ username: out.client.username, quota_remaining: out.client.quota_remaining, monthly_limit: out.client.monthly_limit, valid_until: out.client.valid_until });
  res.json(out);
});

// --- Admin: sites management (multi-site) ---
app.get('/admin/sites', adminMiddleware, (req, res) => {
  const clientId = req.query && req.query.clientId;
  const username = req.query && req.query.username;
  const out = withDb((db) => {
    let client = null;
    if (clientId != null) client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(clientId));
    if (!client && username) client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client) return { ok: false, error: 'client_not_found' };
    const sites = db.prepare('SELECT id, client_id, name, created_at, updated_at FROM sites WHERE client_id = ? ORDER BY id').all(client.id);
    return { ok: true, client: { id: client.id, username: client.username }, sites };
  });
  if (!out.ok) return res.status(404).json(out);
  return res.json(out);
});

app.post('/admin/sites', adminMiddleware, (req, res) => {
  const { clientId, username, name } = req.body || {};
  if ((!username && clientId == null) || !name) return res.status(400).json({ ok: false, error: 'missing_fields' });
  const now = new Date().toISOString();
  const out = withDb((db) => {
    let client = null;
    if (clientId != null) client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(clientId));
    if (!client && username) client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client) return { ok: false, error: 'client_not_found' };
    const nm = String(name).trim();
    if (!nm) return { ok: false, error: 'invalid_name' };
    try {
      db.prepare('INSERT INTO sites (client_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(client.id, nm, now, now);
    } catch (e) {
      return { ok: false, error: 'site_exists' };
    }
    const sites = db.prepare('SELECT id, client_id, name, created_at, updated_at FROM sites WHERE client_id = ? ORDER BY id').all(client.id);
    return { ok: true, sites };
  });
  if (!out.ok) return res.status(400).json(out);
  return res.json(out);
});

app.patch('/admin/sites/:id', adminMiddleware, (req, res) => {
  const id = Number(req.params && req.params.id);
  const { name } = req.body || {};
  if (!id || !name) return res.status(400).json({ ok: false, error: 'missing_fields' });
  const now = new Date().toISOString();
  const out = withDb((db) => {
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
    if (!site) return { ok: false, error: 'site_not_found' };
    const nm = String(name).trim();
    if (!nm) return { ok: false, error: 'invalid_name' };
    try {
      db.prepare('UPDATE sites SET name = ?, updated_at = ? WHERE id = ?').run(nm, now, id);
    } catch (_) {
      return { ok: false, error: 'site_exists' };
    }
    return { ok: true };
  });
  if (!out.ok) return res.status(400).json(out);
  return res.json(out);
});

app.delete('/admin/sites/:id', adminMiddleware, (req, res) => {
  const id = Number(req.params && req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });
  const out = withDb((db) => {
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
    if (!site) return { ok: false, error: 'site_not_found' };
    db.prepare('DELETE FROM sites WHERE id = ?').run(id);
    return { ok: true };
  });
  if (!out.ok) return res.status(400).json(out);
  return res.json(out);
});

// --- Admin: list all sites (for filtering) ---
app.get('/admin/sites/all', adminMiddleware, (_req, res) => {
  const out = withDb((db) => {
    const rows = db.prepare(`
      SELECT s.id, s.client_id, s.name, s.created_at, s.updated_at,
             c.username AS client_username, c.name AS client_name
      FROM sites s
      JOIN clients c ON c.id = s.client_id
      ORDER BY c.id, s.id
    `).all();
    return { ok: true, sites: rows };
  });
  return res.json(out);
});

app.get('/admin/master-dump/latest', adminMiddleware, (req, res) => {
  const clientId = req.query && req.query.clientId;
  const username = req.query && req.query.username;
  const out = withDb((db) => {
    let client = null;
    if (clientId != null) client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(clientId));
    if (!client && username) client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client) return { ok: false, error: 'client_not_found' };
    const dump = db.prepare('SELECT * FROM master_dumps WHERE client_id = ? ORDER BY id DESC LIMIT 1').get(client.id);
    if (!dump) return { ok: false, error: 'no_master_dump' };
    return { ok: true, client: { id: client.id, username: client.username }, dump: { id: dump.id, uid: dump.uid, dump_hex: dump.dump_hex, created_at: dump.created_at } };
  });
  if (!out.ok) return res.status(404).json(out);
  return res.json(out);
});

// --- Admin: set active dump (global) ---
app.post('/admin/dumps/active', adminMiddleware, (req, res) => {
  const { dump_hex, uid, source } = req.body || {};
  if (!dump_hex) return res.status(400).json({ ok: false, error: 'missing_dump' });
  const now = new Date().toISOString();
  const src = (source === 'manual' || source === 'direct') ? source : 'manual';

  const out = withDb((db) => {
    db.prepare("UPDATE dumps SET is_active = 0, updated_at = ? WHERE scope = 'global' AND is_active = 1").run(now);
    db.prepare("INSERT INTO dumps (scope, client_id, site_id, uid, dump_hex, is_active, source, created_at, updated_at) VALUES ('global', NULL, NULL, ?, ?, 1, ?, ?, ?)")
      .run(uid || null, String(dump_hex), src, now, now);
    const row = db.prepare("SELECT * FROM dumps WHERE scope = 'global' AND is_active = 1 ORDER BY id DESC LIMIT 1").get();
    return { ok: true, dump: { id: row.id, uid: row.uid, source: row.source, created_at: row.created_at } };
  });

  return res.json(out);
});

app.get('/admin/dumps/active', adminMiddleware, (_req, res) => {
  const out = withDb((db) => {
    const row = db.prepare("SELECT * FROM dumps WHERE scope = 'global' AND is_active = 1 ORDER BY id DESC LIMIT 1").get();
    if (!row) return { ok: true, dump: null };
    return { ok: true, dump: { id: row.id, uid: row.uid, source: row.source, created_at: row.created_at } };
  });
  return res.json(out);
});

// --- Public: password reset page (used by reset emails) ---
// Minimal HTML that posts to /auth/confirm-reset
function sendResetPage(req, res, rawToken) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const token = String(rawToken || '');
  const safeToken = token.replace(/[^0-9a-zA-Z_-]/g, '');
  return res.status(200).send(`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PROPASS – Mot de passe oublié</title>
  </head>
  <body style="margin:0; background:#f6f6f6; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
    <div style="max-width: 560px; margin: 0 auto; padding: 28px 18px;">
      <div style="text-align:center; font-weight: 900; letter-spacing: 1px;">PROPASS</div>
      <div style="height:14px;"></div>

      <div style="background:#fff; border:1px solid #e9e9e9; border-radius:14px; padding:22px;">
        <div style="font-size:18px; font-weight:800; margin:0;">Mot de passe oublié</div>
        <div style="height:6px;"></div>
        <div style="color:#333; font-size:13px; line-height:18px;">Entrez le token reçu par email puis choisissez un nouveau mot de passe.</div>

        <div style="height:16px;"></div>

        <form id="f" style="display:grid; gap: 12px;">
          <label style="display:grid; gap:6px; font-size:13px; color:#111;">
            Token
            <input id="token" name="token" required value="${safeToken}" autocomplete="one-time-code"
              style="width:100%; padding:12px; border:1px solid #ddd; border-radius:10px; font-size:14px; outline:none;" />
          </label>

          <label style="display:grid; gap:6px; font-size:13px; color:#111;">
            Nouveau mot de passe
            <input id="pw" name="pw" type="password" required autocomplete="new-password"
              style="width:100%; padding:12px; border:1px solid #ddd; border-radius:10px; font-size:14px; outline:none;" />
          </label>

          <button type="submit"
            style="padding:12px; border:0; border-radius:10px; background:#111; color:#fff; font-weight:800; cursor:pointer;">
            Valider
          </button>

          <div id="msg" style="min-height: 18px; font-size: 13px;"></div>
        </form>
      </div>

      <div style="height:12px;"></div>
      <div style="color:#777; font-size:12px; line-height:18px; text-align:center;">Si tu n'es pas à l'origine de cette demande, tu peux fermer cette page.</div>
    </div>

    <script>
      const f = document.getElementById('f');
      const msg = document.getElementById('msg');
      const tokenEl = document.getElementById('token');
      const pwEl = document.getElementById('pw');

      function confirmResetUrl() {
        // Keep any reverse-proxy path prefix (ex: /api/reset -> /api/auth/confirm-reset)
        const u = new URL(window.location.href);
        u.search = '';
        u.hash = '';
        u.pathname = String(u.pathname || '').replace(/\/reset\/?$/, '/auth/confirm-reset');
        return u.toString();
      }

      function setMsg(text, ok) {
        msg.textContent = String(text || '');
        msg.style.color = ok ? '#0a7a0a' : '#b00020';
      }

      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        setMsg('Envoi...', true);
        try {
          const token = String(tokenEl.value || '').trim();
          const pw = String(pwEl.value || '');
          const res = await fetch(confirmResetUrl(), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token, new_password: pw })
          });
          const json = await res.json().catch(() => null);
          if (!res.ok || !(json && json.ok)) {
            setMsg((json && json.error) ? json.error : 'Erreur', false);
            return;
          }
          setMsg('Mot de passe modifi\u00e9. Tu peux revenir dans l\'application et te connecter.', true);
        } catch (err) {
          setMsg(String(err && err.message || err), false);
        }
      });
    </script>
  </body>
</html>`);

}

app.get('/reset', (req, res) => {
  const token = String((req.query && req.query.token) || '');
  return sendResetPage(req, res, token);
});

// Backward/alternate format support: /reset/<token>
app.get('/reset/:token', (req, res) => {
  return sendResetPage(req, res, req.params && req.params.token);
});

// --- Client: request password reset ---
app.post('/auth/request-reset', (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, error: 'missing_username' });

  const out = withDb((db) => {
    const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(String(username));
    if (!client || !client.email) {
      // Don't leak existence
      return { ok: true, sent: true };
    }
    const token = newToken(24);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO password_resets (client_id, token, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)')
      .run(client.id, token, expiresAt, createdAt);
    return { ok: true, token, email: client.email };
  });

  // Send email out of transaction
  const publicBase = getPublicBaseUrl(req);
  (async () => {
    try {
      if (!out || !out.token) return;
      const resetUrl = `${String(publicBase).replace(/\/$/, '')}/reset?token=${out.token}`;
      await sendPasswordResetEmail({ to: out.email, resetUrl });
      console.log('[MAIL] reset sent to', out.email);
    } catch (e) {
      console.warn('[MAIL] reset email failed', e && e.message);
    }
  })();

  // Always return ok
  return res.json({ ok: true, sent: true });
});

// --- Client: confirm password reset ---
app.post('/auth/confirm-reset', (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token || !new_password) return res.status(400).json({ ok: false, error: 'missing_fields' });

  const pw = hashPassword(String(new_password));
  const now = new Date().toISOString();

  const out = withDb((db) => {
    const row = db.prepare('SELECT * FROM password_resets WHERE token = ? ORDER BY id DESC LIMIT 1').get(String(token));
    if (!row) return { ok: false, error: 'invalid_token' };
    if (row.used_at) return { ok: false, error: 'token_used' };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: 'token_expired' };

    db.prepare('UPDATE clients SET password_hash = ?, updated_at = ? WHERE id = ?').run(pw, now, row.client_id);
    db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(now, row.id);
    return { ok: true };
  });

  if (!out.ok) return res.status(400).json(out);
  return res.json(out);
});

// --- HTTP server + WS ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const wsClients = new Map(); // ws -> { username }

function broadcastQuotaUpdate({ username, quota_remaining, monthly_limit, valid_until }) {
  const msg = JSON.stringify({
    type: 'quota:update',
    username,
    quota: {
      remaining: Number(quota_remaining || 0),
      monthly_limit: Number(monthly_limit || 15),
      valid_until: valid_until || null
    }
  });

  for (const [ws, info] of wsClients.entries()) {
    if (ws.readyState !== ws.OPEN) continue;
    if (info && info.username === username) {
      try { ws.send(msg); } catch (_) {}
    }
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (buf) => {
    try {
      const msg = JSON.parse(String(buf || ''));
      if (msg && msg.type === 'auth' && msg.token) {
        const payload = jwt.verify(String(msg.token), JWT_SECRET);
        wsClients.set(ws, { username: payload.username });
        ws.send(JSON.stringify({ type: 'auth:ok' }));
        return;
      }
      ws.send(JSON.stringify({ type: 'error', error: 'unknown_message' }));
    } catch (_) {
      try { ws.send(JSON.stringify({ type: 'error', error: 'bad_message' })); } catch (_) {}
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`PROPASS cloud listening on http://localhost:${PORT}`);
});
