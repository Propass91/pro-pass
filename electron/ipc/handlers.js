const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const { BrowserWindow } = require('electron');
const { shell } = require('electron');
const { app } = require('electron');
const { dialog } = require('electron');
const {
  getDatabasePath,
  getClients,
  getClientById,
  getClientByUsername,
  updateClientQuotaAndValidity,
  decrementQuotaByUsername,
  insertMasterDump,
  getLatestMasterDumpForClient
  ,authenticateUser
  ,getClientForUser
} = require('../db/database');

const { CloudClient } = require('../cloud/cloudClient');

const cloud = new CloudClient();

function broadcastToAllWindows(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    try { w.webContents.send(channel, payload); } catch (_) {}
  });
}

function emitNfcPyLog(line) {
  const msg = String(line == null ? '' : line);
  broadcastToAllWindows('nfc:pyLog', msg);
}

let presenceWatcher = null; // ChildProcess
let presenceWatcherBuf = '';

function stopPresenceWatcher() {
  if (!presenceWatcher) return;
  try { presenceWatcher.kill('SIGKILL'); } catch (_) {}
  presenceWatcher = null;
  presenceWatcherBuf = '';
}

function startPresenceWatcher() {
  if (presenceWatcher && !presenceWatcher.killed) {
    return { success: true, running: true };
  }

  const scriptPath = resolveResourcePath('backend', 'nfc', 'presence_watch.py');
  const pyExe = 'python';
  const child = spawn(pyExe, [scriptPath], {
    env: { ...process.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  presenceWatcher = child;
  presenceWatcherBuf = '';

  const onLine = (line) => {
    const txt = String(line || '').trim();
    if (!txt) return;
    if (!txt.startsWith('{')) {
      emitNfcPyLog(`[watch] ${txt}`);
      return;
    }
    try {
      const msg = JSON.parse(txt);
      if (msg && msg.type === 'present') {
        broadcastToAllWindows('nfc:cardPresent', msg.uid || null);
        return;
      }
      if (msg && msg.type === 'removed') {
        broadcastToAllWindows('nfc:cardRemoved');
        return;
      }
      if (msg && msg.type === 'error') {
        emitNfcPyLog(`[watch:error] ${String(msg.error || 'ERROR')}`);
        return;
      }
    } catch (_) {
      emitNfcPyLog(`[watch] ${txt}`);
    }
  };

  try {
    child.stdout.on('data', (d) => {
      presenceWatcherBuf += String(d || '');
      const parts = presenceWatcherBuf.split(/\r?\n/);
      presenceWatcherBuf = parts.pop() || '';
      for (const p of parts) onLine(p);
    });
    child.stderr.on('data', (d) => emitNfcPyLog(`[watch:stderr] ${String(d || '')}`));
  } catch (_) {}

  child.on('exit', () => {
    presenceWatcher = null;
    presenceWatcherBuf = '';
  });

  child.on('error', (e) => {
    emitNfcPyLog(`[watch:error] ${String(e && e.message || e)}`);
    stopPresenceWatcher();
  });

  return { success: true, running: true };
}

cloud.on('quota:update', (q) => {
  broadcastToAllWindows('cloud:quotaUpdate', q);
});

function resolveResourcePath(...parts) {
  const candidates = [];
  if (process && process.resourcesPath) candidates.push(path.join(process.resourcesPath, ...parts));
  candidates.push(path.join(__dirname, '..', '..', ...parts));
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;

      // If sources are excluded from packaging, prefer compiled Python bytecode.
      // This allows calls that reference "*.py" to work with shipped "*.pyc".
      if (candidate && candidate.toLowerCase().endsWith('.py')) {
        const pyc = candidate + 'c'; // .py -> .pyc
        if (fs.existsSync(pyc)) return pyc;
      }
    } catch (_) {
      // ignore
    }
  }
  return path.join(__dirname, '..', '..', ...parts);
}

function getVaultDir() {
  return path.join(__dirname, '..', '..', 'VAULT');
}

function getUserVaultDir() {
  const base = app.getPath('userData');
  return path.join(base, 'VAULT');
}

function ensureDir(p) {
  try {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  } catch (_) {}
}

function getUserVaultDumpPath() {
  const dir = getUserVaultDir();
  ensureDir(dir);
  return path.join(dir, 'SOURCE_ZERO.bin');
}

function getUserVaultMetaPath() {
  const dir = getUserVaultDir();
  ensureDir(dir);
  return path.join(dir, 'SOURCE_ZERO.meta.json');
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readDumpMeta() {
  try {
    const p = getUserVaultMetaPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeDumpMeta(meta) {
  try {
    const p = getUserVaultMetaPath();
    fs.writeFileSync(p, JSON.stringify(meta || {}, null, 2), 'utf8');
  } catch (_) {}
}

async function fetchActiveDumpBinary({ clientId, ifNoneMatch } = {}) {
  if (!cloud || !cloud.baseUrl) throw new Error('CLOUD_NOT_READY');
  if (!cloud.token) throw new Error('not_authenticated');

  const url = `${String(cloud.baseUrl).replace(/\/+$/, '')}/api/client/dump/active`;
  const headers = {
    Authorization: `Bearer ${cloud.token}`
  };
  if (clientId != null) headers['client-id'] = String(clientId);
  if (ifNoneMatch) headers['If-None-Match'] = String(ifNoneMatch);

  const res = await fetch(url, { method: 'GET', headers });
  if (res.status === 304) {
    return { ok: true, notModified: true, status: 304, hash: String(res.headers.get('etag') || ifNoneMatch || '') };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`HTTP_${res.status}`);
    err.status = res.status;
    err.body = txt;
    throw err;
  }

  const ab = await res.arrayBuffer();
  const bytes = Buffer.from(ab);
  const hash = String(res.headers.get('x-dump-hash') || res.headers.get('etag') || sha256Hex(bytes));
  const updatedAt = String(res.headers.get('x-dump-updated-at') || '');
  return { ok: true, notModified: false, status: res.status, bytes, hash, updatedAt };
}

let dumpSyncTimer = null;

async function forceDumpRefresh({ clientId } = {}) {
  const localMeta = readDumpMeta();
  const localHash = localMeta && localMeta.hash ? String(localMeta.hash) : null;
  const r = await fetchActiveDumpBinary({ clientId, ifNoneMatch: localHash });
  if (r && r.ok && r.notModified) {
    return { updated: false, hash: localHash, lastSyncTs: Number(localMeta && localMeta.lastSyncTs || 0) || Date.now() };
  }

  const dumpPath = getUserVaultDumpPath();
  ensureDir(path.dirname(dumpPath));
  fs.writeFileSync(dumpPath, r.bytes);

  const meta = {
    hash: r.hash || sha256Hex(r.bytes),
    lastSyncTs: Date.now(),
    cloudUpdatedAt: r.updatedAt || null,
    source: 'cloud'
  };
  writeDumpMeta(meta);
  broadcastToAllWindows('dump:updated', { hash: meta.hash, lastSyncTs: meta.lastSyncTs });
  return { updated: true, hash: meta.hash, lastSyncTs: meta.lastSyncTs };
}

function startDumpSyncLoop({ clientId } = {}) {
  try {
    if (dumpSyncTimer) clearInterval(dumpSyncTimer);
  } catch (_) {}
  dumpSyncTimer = null;

  // Force refresh from cloud once per app/session start (spec)
  forceDumpRefresh({ clientId }).catch(() => {});

  dumpSyncTimer = setInterval(() => {
    forceDumpRefresh({ clientId }).catch(() => {});
  }, 5 * 60 * 1000);
}

function stopDumpSyncLoop() {
  try {
    if (dumpSyncTimer) clearInterval(dumpSyncTimer);
  } catch (_) {}
  dumpSyncTimer = null;
}

function bufferToHex(buf) {
  if (!buf) return '';
  return Buffer.isBuffer(buf) ? buf.toString('hex') : Buffer.from(buf).toString('hex');
}

function extractHexFromText(text) {
  const cleaned = String(text || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (cleaned.length >= 2048) return cleaned.slice(0, 2048);
  return null;
}

function formatVaultStamp(d = new Date()) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}h${min}`;
}

function saveVaultSnapshot({ vaultDir, bytes }) {
  const stamp = formatVaultStamp(new Date());
  const fileName = `dump_${stamp}.bin`;
  const snapPath = path.join(vaultDir, fileName);
  fs.writeFileSync(snapPath, bytes);
  return snapPath;
}

async function runPythonDump() {
  const vaultDir = getVaultDir();
  try { if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true }); } catch (_) {}
  const outPath = path.join(vaultDir, 'SOURCE_ZERO.bin');

  const scriptPath = resolveResourcePath('backend', 'nfc', 'dump.py');
  const env = {
    ...process.env,
    PROPASS_VAULT_DIR: vaultDir,
    PROPASS_OUT_PATH: outPath
  };

  // BRUTE execution as requested: exec("python …")
  const pyExe = 'python';
  const command = `${pyExe} "${scriptPath}" --vault "${vaultDir}" --out "${outPath}" --stdout`;

  emitNfcPyLog(`[exec] ${command}`);

  const result = await new Promise((resolve) => {
    const child = exec(command, {
      env,
      windowsHide: true,
      timeout: 10000,
      killSignal: 'SIGKILL',
      maxBuffer: 15 * 1024 * 1024
    }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || ''), outPath });
    });

    try {
      if (child && child.stdout) {
        child.stdout.on('data', (d) => emitNfcPyLog(String(d || '')));
      }
      if (child && child.stderr) {
        child.stderr.on('data', (d) => emitNfcPyLog(String(d || '')));
      }
    } catch (_) {}
  });

  if (result && result.error) {
    const err = result.error;
    const isTimeout = !!(err && (err.killed || String(err.signal || '').toUpperCase().includes('SIG')) && String(err.message || '').toLowerCase().includes('timed'));
    if (isTimeout) {
      emitNfcPyLog('[timeout] Python dump killed after 10s');
      return { success: false, error: 'CARD_TIMEOUT' };
    }
    if (err && err.code === 'ENOENT') {
      emitNfcPyLog('[error] python not found');
      return { success: false, error: 'PYTHON_NOT_FOUND' };
    }
  }

  const stdout = (result && result.stdout) || '';

  // Prefer JSON if provided
  const txt = String(stdout || '').trim();
  if (txt.startsWith('{')) {
    try {
      const j = JSON.parse(txt);
      if (j && j.success && j.dump_hex) {
        const dumpHex = String(j.dump_hex);
        // Ensure VAULT/SOURCE_ZERO.bin exists
        try {
          if (!fs.existsSync(outPath)) {
            fs.writeFileSync(outPath, Buffer.from(dumpHex, 'hex'));
          }
        } catch (_) {}

        // Timestamped snapshot in VAULT
        let snapshotPath = null;
        try {
          const bytes = fs.readFileSync(outPath);
          snapshotPath = saveVaultSnapshot({ vaultDir, bytes });
          emitNfcPyLog(`[vault] snapshot saved: ${snapshotPath}`);
        } catch (_) {}

        try { shell.beep(); } catch (_) {}
        return { success: true, uid: j.uid || null, dumpHex, snapshotPath };
      }
      if (j && j.success) {
        if (fs.existsSync(outPath)) {
          const buf = fs.readFileSync(outPath);
          const dumpHex = bufferToHex(buf);
          if (dumpHex && dumpHex.length >= 2048) {
            let snapshotPath = null;
            try {
              snapshotPath = saveVaultSnapshot({ vaultDir, bytes: buf });
              emitNfcPyLog(`[vault] snapshot saved: ${snapshotPath}`);
            } catch (_) {}
            try { shell.beep(); } catch (_) {}
            return { success: true, uid: j.uid || null, dumpHex: dumpHex.slice(0, 2048), snapshotPath };
          }
        }
      }
      if (j && j.error) return { success: false, error: String(j.error) };
    } catch (_) {}
  }

  // Otherwise try to parse HEX from stdout
  const hex = extractHexFromText(stdout);
  if (hex) {
    try {
      fs.writeFileSync(outPath, Buffer.from(hex, 'hex'));
    } catch (_) {}
    let snapshotPath = null;
    try {
      const bytes = fs.readFileSync(outPath);
      snapshotPath = saveVaultSnapshot({ vaultDir, bytes });
      emitNfcPyLog(`[vault] snapshot saved: ${snapshotPath}`);
    } catch (_) {}
    try { shell.beep(); } catch (_) {}
    return { success: true, uid: null, dumpHex: hex, snapshotPath };
  }

  // Or read the VAULT file
  try {
    if (fs.existsSync(outPath)) {
      const buf = fs.readFileSync(outPath);
      const dumpHex = bufferToHex(buf);
      if (dumpHex && dumpHex.length >= 2048) {
        let snapshotPath = null;
        try {
          snapshotPath = saveVaultSnapshot({ vaultDir, bytes: buf });
          emitNfcPyLog(`[vault] snapshot saved: ${snapshotPath}`);
        } catch (_) {}
        try { shell.beep(); } catch (_) {}
        return { success: true, uid: null, dumpHex: dumpHex.slice(0, 2048), snapshotPath };
      }
    }
  } catch (_) {}

  return { success: false, error: 'NO_READER' };
}

async function runPythonWriteFromVault() {
  const vaultDir = getUserVaultDir();
  ensureDir(vaultDir);
  const sourcePath = path.join(vaultDir, 'SOURCE_ZERO.bin');
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: 'NO_DUMP', path: sourcePath };
  }
  try {
    const st = fs.statSync(sourcePath);
    if (!st || st.size < 1024) return { success: false, error: 'DUMP_TOO_SMALL', size: st ? st.size : 0 };
  } catch (_) {}

  // MUST execute this script for the client copy flow (real, verifiable).
  const scriptPath = resolveResourcePath('backend', 'copy_process.py');
  const env = {
    ...process.env,
    PROPASS_VAULT_DIR: vaultDir,
    PROPASS_SOURCE_PATH: sourcePath
  };

  const pyExe = 'python';
  emitNfcPyLog(`[spawn] ${pyExe} "${scriptPath}"`);

  const result = await new Promise((resolve) => {
    let stdoutAll = '';
    let stderrAll = '';
    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;
    let stopRequested = false;

    const child = spawn(pyExe, [scriptPath], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    const maybeStopOnFailure = (line) => {
      if (stopRequested) return;
      if (!line) return;
      if (/\bECHEC\b/i.test(line)) {
        stopRequested = true;
        try { emitNfcPyLog('ECHEC: ARRET IMMEDIAT'); } catch (_) {}
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    };

    const flushLines = (buf) => {
      const parts = buf.split(/\r?\n/);
      const rest = parts.pop() || '';
      for (const p of parts) {
        const line = String(p || '').trimEnd();
        if (!line) continue;
        emitNfcPyLog(line);
        maybeStopOnFailure(line);
      }
      return rest;
    };

    const killTimer = setTimeout(() => {
      try { emitNfcPyLog('ECHEC: TIMEOUT'); } catch (_) {}
      try { child.kill('SIGKILL'); } catch (_) {}
    }, 60_000);

    try {
      child.stdout.on('data', (d) => {
        const s = String(d || '');
        stdoutAll += s;
        stdoutBuf += s;
        stdoutBuf = flushLines(stdoutBuf);
      });
      child.stderr.on('data', (d) => {
        const s = String(d || '');
        stderrAll += s;
        stderrBuf += s;
        const parts = stderrBuf.split(/\r?\n/);
        stderrBuf = parts.pop() || '';
        for (const p of parts) {
          const line = String(p || '').trimEnd();
          if (!line) continue;
          emitNfcPyLog(`[stderr] ${line}`);
          maybeStopOnFailure(line);
        }
      });
    } catch (_) {}

    child.on('error', (e) => {
      try { clearTimeout(killTimer); } catch (_) {}
      finish({ ok: false, code: null, signal: null, error: String(e && e.message || e), stdout: stdoutAll, stderr: stderrAll });
    });

    child.on('exit', (code, signal) => {
      try { clearTimeout(killTimer); } catch (_) {}
      // Flush remaining partial line buffers
      try {
        const r1 = String(stdoutBuf || '').trim();
        if (r1) emitNfcPyLog(r1);
      } catch (_) {}
      try {
        const r2 = String(stderrBuf || '').trim();
        if (r2) emitNfcPyLog(`[stderr] ${r2}`);
      } catch (_) {}

      finish({ ok: true, code: Number(code), signal: signal ? String(signal) : null, stdout: stdoutAll, stderr: stderrAll });
    });
  });

  if (!result || result.ok === false) {
    return { success: false, error: String(result && result.error || 'SPAWN_FAILED') };
  }
  if (result.code !== 0) {
    return { success: false, error: `PY_EXIT_${result.code}` };
  }

  const out = String((result && result.stdout) || '').trim();
  const lines = out.split(/\r?\n/).map((s) => String(s || '').trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{')) continue;
    try {
      const j = JSON.parse(line);
      if (j && j.success) {
        return {
          success: true,
          uidCloned: j.uid || null,
          blocksWritten: Number(j.blocks_written || 0)
        };
      }
      if (j && j.success === false) {
        return { success: false, error: String(j.error || 'WRITE_FAILED') };
      }
    } catch (_) {}
  }

  // Exit code 0 but no parsable JSON success -> treat as failure
  return { success: false, error: 'WRITE_FAILED' };
}

let NFCService = null;
try {
  const nfcPath = resolveResourcePath('electron', 'nfc', 'nfcService.js');
  const mod = require(nfcPath);
  NFCService = mod.NFCService || mod.default || mod;
} catch (_) {
  try {
    NFCService = require('../nfc/nfcService').NFCService;
  } catch (_e2) {
    NFCService = null;
  }
}

let nfcService = null;

const adminLogBuffer = [];
function emitAdminLog(line) {
  const msg = `[${new Date().toISOString()}] ${String(line || '')}`;
  adminLogBuffer.push(msg);
  while (adminLogBuffer.length > 250) adminLogBuffer.shift();
  BrowserWindow.getAllWindows().forEach((w) => {
    try {
      w.webContents.send('admin:log', msg);
    } catch (_) {}
  });
}

const MASTER_PASSWORD = process.env.PROPASS_MASTER_PASSWORD || 'PROPASS';
const adminSessions = new Set();
function newAdminToken() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function assertAdmin(token) {
  if (!token || !adminSessions.has(String(token))) {
    throw new Error('Accès admin refusé');
  }
}

let authSessionUser = null;

function registerHandlers(ipcMain) {
  // --- Auth ---
  ipcMain.handle('auth:login', async (_event, username, password) => {
    // Online verification each session (mandatory)
    const online = await cloud.checkOnline();
    if (!online) {
      emitAdminLog(`LOGIN FAIL (offline) username=${String(username || '')}`);
      return { success: false, error: 'OFFLINE' };
    }

    try {
      const r = await cloud.login(String(username || ''), String(password || ''));
      const role = String(r && r.role || 'client');
      const token = r && r.token ? String(r.token) : null;
      if (role === 'admin') {
        authSessionUser = {
          id: (r.user && r.user.id) || null,
          username: (r.user && r.user.username) || String(username || ''),
          role: 'admin',
          email: null,
          clientUsername: null
        };
        emitAdminLog(`LOGIN OK (cloud) username=${authSessionUser.username} role=admin`);
        return { success: true, user: authSessionUser, token, role: 'admin' };
      }

      authSessionUser = {
        id: (r.client && r.client.id) || null,
        username: (r.client && r.client.username) || String(username || ''),
        role: 'client',
        email: (r.client && r.client.email) || null,
        clientUsername: (r.client && r.client.username) || String(username || '')
      };
      emitAdminLog(`LOGIN OK (cloud) username=${authSessionUser.username} role=client`);

      // Dump sync loop (cloud-first, cached locally)
      try {
        startDumpSyncLoop({ clientId: authSessionUser.id || null });
      } catch (_) {}

      // push quota immediately after login (client)
      try {
        const q = await cloud.getQuota();
        broadcastToAllWindows('cloud:quotaUpdate', q);
      } catch (_) {}

      return { success: true, user: authSessionUser, token, role: 'client' };
    } catch (e) {
      emitAdminLog(`LOGIN FAIL (cloud) username=${String(username || '')}`);
      return { success: false, error: 'INVALID_CREDENTIALS' };
    }
  });

  ipcMain.handle('auth:restoreSession', async (_event, payload = {}) => {
    const online = await cloud.checkOnline();
    if (!online) return { success: false, error: 'OFFLINE' };

    const token = payload && payload.token ? String(payload.token) : null;
    const user = payload && payload.user && typeof payload.user === 'object' ? payload.user : null;
    if (!token || !user) return { success: false, error: 'missing_session' };

    const role = String(user.role || 'client');
    const username = String(user.username || user.clientUsername || '');
    if (!username) return { success: false, error: 'missing_user' };

    // Rehydrate CloudClient session
    cloud.token = token;
    cloud.role = role;
    cloud.username = username;

    authSessionUser = {
      id: user.id || null,
      username,
      role,
      email: user.email || null,
      clientUsername: user.clientUsername || (role === 'client' ? username : null)
    };

    try {
      if (role === 'client') {
        try { await cloud.connectWs(); } catch (_) {}
        await cloud.getQuota();

        // Dump sync loop (cloud-first, cached locally)
        try {
          startDumpSyncLoop({ clientId: authSessionUser && authSessionUser.id || null });
        } catch (_) {}
      } else {
        // Validate token by calling a protected admin endpoint
        await cloud.adminGetStats();
      }
      emitAdminLog(`SESSION RESTORE OK username=${username} role=${role}`);
      return { success: true, user: authSessionUser };
    } catch (e) {
      emitAdminLog(`SESSION RESTORE FAIL username=${username} role=${role}`);
      authSessionUser = null;
      try { cloud.logout(); } catch (_) {}
      return { success: false, error: 'INVALID_SESSION' };
    }
  });

  ipcMain.handle('auth:getCurrentUser', async () => {
    return authSessionUser;
  });

  ipcMain.handle('auth:logout', async () => {
    authSessionUser = null;
    try { cloud.logout(); } catch (_) {}
    try { stopDumpSyncLoop(); } catch (_) {}
    return { success: true };
  });

  ipcMain.handle('auth:requestReset', async (_event, payload = {}) => {
    const username = payload && payload.username;
    if (!username) return { success: false, error: 'missing_username' };
    const online = await cloud.checkOnline();
    if (!online) return { success: false, error: 'OFFLINE' };
    await cloud.requestPasswordReset(String(username));
    return { success: true };
  });

  ipcMain.handle('auth:confirmReset', async (_event, payload = {}) => {
    const token = payload && payload.token;
    const newPassword = payload && payload.newPassword;
    if (!token || !newPassword) return { success: false, error: 'missing_fields' };
    const online = await cloud.checkOnline();
    if (!online) return { success: false, error: 'OFFLINE' };
    await cloud.confirmPasswordReset(String(token), String(newPassword));
    return { success: true };
  });
  // --- Admin ---
  ipcMain.handle('admin:login', async (_event, password) => {
    if (String(password || '') !== String(MASTER_PASSWORD)) {
      emitAdminLog('ADMIN LOGIN FAILED');
      return { success: false };
    }
    const token = newAdminToken();
    adminSessions.add(token);
    emitAdminLog('ADMIN LOGIN OK');
    return { success: true, token };
  });

  ipcMain.handle('admin:getSessionToken', async () => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false };
    }
    const token = newAdminToken();
    adminSessions.add(token);
    emitAdminLog('ADMIN SESSION TOKEN ISSUED');
    return { success: true, token };
  });

  // --- Sites (for Sidebar) ---
  ipcMain.handle('sites:getAll', async () => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    const sites = await cloud.adminListAllSites();
    return { success: true, sites };
  });

  ipcMain.handle('sites:create', async (_event, payload = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    const clientUsername = payload && (payload.clientUsername || payload.username);
    const name = payload && payload.name;
    if (!clientUsername || !name) return { success: false, error: 'missing_fields' };
    const sites = await cloud.adminCreateSite({ username: String(clientUsername), name: String(name) });
    emitAdminLog(`SITE CREATE client=${String(clientUsername)} name=${String(name)}`);
    return { success: true, sites };
  });

  ipcMain.handle('admin:getDbPath', async (_event, token) => {
    assertAdmin(token);
    return { success: true, path: getDatabasePath() };
  });

  ipcMain.handle('admin:backupDb', async (_event, token) => {
    assertAdmin(token);
    const dbPath = getDatabasePath();
    if (!fs.existsSync(dbPath)) {
      throw new Error(`database.db introuvable: ${dbPath}`);
    }
    const result = await dialog.showOpenDialog({
      title: 'Choisir un dossier de sauvegarde',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return { success: false, canceled: true };
    }
    const outDir = result.filePaths[0];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(outDir, `database_backup_${stamp}.db`);
    fs.copyFileSync(dbPath, outPath);
    emitAdminLog(`DB BACKUP -> ${outPath}`);
    return { success: true, outPath };
  });

  ipcMain.handle('admin:listClients', async (_event, token) => {
    assertAdmin(token);
    const clients = await cloud.adminListClients();
    return { success: true, clients };
  });

  ipcMain.handle('admin:addQuota', async (_event, token, payload) => {
    assertAdmin(token);
    const clientId = payload && payload.clientId;
    const username = payload && payload.username;
    const addQuota = payload && payload.addQuota;

    const row = await cloud.adminAddQuota({ clientId, username, addQuota, validityDays: 30 });
    emitAdminLog(`ADD QUOTA cloud client=${row && (row.username || row.id)} +${addQuota} -> remaining=${row && row.quota_remaining}`);
    return { success: true, client: row };
  });

  ipcMain.handle('admin:createMasterDump', async (_event, token, payload) => {
    assertAdmin(token);
    const mode = (payload && payload.mode) || 'direct';
    const clientId = payload && payload.clientId;
    const username = payload && payload.username;
    const siteId = payload && payload.siteId;

    if (mode === 'manual') {
      const dumpHex = payload && payload.dumpHex;
      const uid = payload && payload.uid;
      if (!dumpHex) throw new Error('Dump manuel requis');
      emitAdminLog(`MASTER DUMP MANUAL START client=${username || clientId}`);
      const client = await cloud.adminUpsertMasterDump({ clientId, username, dumpHex: String(dumpHex), uid: uid || null, source: 'manual', siteId });
      emitAdminLog(`MASTER DUMP MANUAL OK client=${username || clientId}`);
      return { success: true, client };
    }

    // MODE AUTOMATIQUE (Direct Hardware)
    if (!nfcService) {
      if (!NFCService) throw new Error('NFCService indisponible');
      nfcService = new NFCService();
      await nfcService.init();
    }

    emitAdminLog(`MASTER DUMP DIRECT START client=${username || clientId}`);
    const res = await nfcService.readDump();
    if (!res || !res.success) throw new Error(res && res.error ? res.error : 'Lecture NFC échouée');
    const dumpHex = Buffer.isBuffer(res.dump) ? res.dump.toString('hex') : String(res.dump || '');
    const client = await cloud.adminUpsertMasterDump({ clientId, username, dumpHex, uid: res.uid || null, source: 'direct', siteId });
    emitAdminLog(`MASTER DUMP DIRECT OK client=${username || clientId} uid=${res.uid || ''}`);
    return { success: true, client };
  });

  // --- Multi-sites ---
  ipcMain.handle('admin:listSites', async (_event, token, payload = {}) => {
    assertAdmin(token);
    const clientId = payload && payload.clientId;
    const username = payload && payload.username;
    const sites = await cloud.adminListSites({ clientId, username });
    return { success: true, sites };
  });

  ipcMain.handle('admin:createSite', async (_event, token, payload = {}) => {
    assertAdmin(token);
    const clientId = payload && payload.clientId;
    const username = payload && payload.username;
    const name = payload && payload.name;
    const sites = await cloud.adminCreateSite({ clientId, username, name: String(name || '') });
    emitAdminLog(`SITE CREATE client=${username || clientId} name=${String(name || '')}`);
    return { success: true, sites };
  });

  ipcMain.handle('admin:renameSite', async (_event, token, payload = {}) => {
    assertAdmin(token);
    const siteId = payload && payload.siteId;
    const name = payload && payload.name;
    await cloud.adminRenameSite({ siteId, name: String(name || '') });
    emitAdminLog(`SITE RENAME id=${siteId} name=${String(name || '')}`);
    return { success: true };
  });

  ipcMain.handle('admin:deleteSite', async (_event, token, payload = {}) => {
    assertAdmin(token);
    const siteId = payload && payload.siteId;
    await cloud.adminDeleteSite({ siteId });
    emitAdminLog(`SITE DELETE id=${siteId}`);
    return { success: true };
  });

  ipcMain.handle('admin:listAllSites', async (_event, token) => {
    assertAdmin(token);
    const sites = await cloud.adminListAllSites();
    return { success: true, sites };
  });

  ipcMain.handle('admin:testCopy', async (_event, token, payload) => {
    assertAdmin(token);
    const clientId = payload && payload.clientId;
    const username = payload && payload.username;
    const dump = await cloud.adminGetLatestMasterDump({ clientId, username });

    if (!nfcService) {
      if (!NFCService) throw new Error('NFCService indisponible');
      nfcService = new NFCService();
      await nfcService.init();
    }

    emitAdminLog(`TEST COPY START client=${username || clientId}`);
    const writeRes = await nfcService.writeDump(String(dump.dumpHex));
    if (!writeRes || !writeRes.success) {
      emitAdminLog(`TEST COPY FAIL client=${username || clientId}`);
      return { success: false, error: writeRes && writeRes.error ? writeRes.error : 'Écriture échouée' };
    }
    emitAdminLog(`TEST COPY OK clientId=${clientId} blocks=${writeRes.blocksWritten}`);
    return { success: true, result: writeRes };
  });

  ipcMain.handle('admin:getAdminLogs', async (_event, token) => {
    assertAdmin(token);
    return { success: true, logs: adminLogBuffer.slice(-200) };
  });

  ipcMain.handle('admin:getLogs', async (_event, filters = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const r = await cloud.adminGetLogs(filters || {});
      return { success: true, ...r };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:exportLogs', async (_event, filters = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }

    const pad2 = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const defaultName = `logs_propass_${stamp}.csv`;

    const pick = await dialog.showSaveDialog({
      title: 'Télécharger les logs (CSV)',
      defaultPath: path.join(app.getPath('downloads'), defaultName),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (pick.canceled || !pick.filePath) return { success: false, canceled: true };

    const filePath = pick.filePath;

    // Server-side pagination export (lazy): fetch in pages to keep memory bounded.
    const limit = 5000;
    let page = 1;
    let total = 0;
    let pageCount = 1;

    const escapeCsv = (v) => {
      const s = String(v == null ? '' : v);
      if (/[",\n\r;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };

    const header = ['ID', 'Société', 'Action', 'Date', 'Heure'].join(';') + '\n';
    fs.writeFileSync(filePath, header, 'utf8');

    do {
      const r = await cloud.adminGetLogs({ ...(filters || {}), page, limit });
      total = Number(r.total || 0);
      pageCount = Number(r.pageCount || 1);
      const rows = Array.isArray(r.rows) ? r.rows : [];

      let chunk = '';
      for (const row of rows) {
        const ts = Number(row.ts);
        const dt = Number.isFinite(ts) ? new Date(ts) : new Date();
        const date = dt.toLocaleDateString('fr-FR');
        const time = dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const id = `#${row.id}`;
        chunk += [
          escapeCsv(id),
          escapeCsv(row.company_name || '—'),
          escapeCsv(row.action || '—'),
          escapeCsv(date),
          escapeCsv(time)
        ].join(';') + '\n';
      }
      if (chunk) fs.appendFileSync(filePath, chunk, 'utf8');
      page += 1;
      // safety to avoid runaway export
      if (page > 5000) break;
    } while (page <= pageCount);

    return { success: true, filePath, total };
  });

  // --- Admin Dashboard (server-backed stats) ---
  ipcMain.handle('admin:getStats', async () => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const stats = await cloud.adminGetStats();
      return { success: true, stats };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:getCopyStats', async (_event, period) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const stats = await cloud.adminGetCopyStats(String(period || 'monthly'));
      return { success: true, ...stats };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:syncCopyEvents', async (_event, events) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const r = await cloud.adminSyncCopyEvents(Array.isArray(events) ? events : []);
      return { success: true, inserted: Number(r && r.inserted || 0) };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  // --- Admin Clients CRUD (for Mes clients page) ---
  ipcMain.handle('admin:getClients', async () => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const clients = await cloud.adminListClients();
      return { success: true, clients };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:createClient', async (_event, payload = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const r = await cloud.adminCreateClient(payload || {});
      return { success: true, client: r.client, tempPassword: r.tempPassword || null };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:updateClient', async (_event, id, payload = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const client = await cloud.adminUpdateClient(id, payload || {});
      return { success: true, client };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:toggleClientStatus', async (_event, id) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const client = await cloud.adminToggleClientStatus(id);
      return { success: true, client };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:sendInvitationEmail', async (_event, clientId) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const r = await cloud.adminSendInvitationEmail(clientId);
      return { success: true, ...r };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('ppc:hw-status-nfc', async () => {
    const connected = !!(nfcService && nfcService.isConnected());
    return { ok: true, connected, reader: connected ? nfcService.getReaderName() : null };
  });

  ipcMain.handle('ppc:nfc-read-gen2', async () => {
    try {
      if (!nfcService) return { ok: false, error: 'NFC non initialisé' };
      const result = await nfcService.readDump();
      if (!result.success) return { ok: false, error: result.error };
      const vaultDir = path.join(__dirname, '..', '..', 'VAULT');
      if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
      const outPath = path.join(vaultDir, 'SOURCE_ZERO.bin');
      fs.writeFileSync(outPath, result.dump);
      return { ok: true, path: outPath, blocks: result.blocksRead, uid: result.uid };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ppc:nfc-write-gen2', async (_event, vaultPath) => {
    try {
      if (!nfcService) return { ok: false, error: 'NFC non initialisé' };
      if (!vaultPath) throw new Error('vault path required');
      if (!fs.existsSync(vaultPath)) throw new Error('vault file missing');
      const buf = fs.readFileSync(vaultPath);
      if (buf.length < 1024) throw new Error('vault dump too small');
      const result = await nfcService.writeDump(buf.toString('hex'));
      if (!result.success) return { ok: false, error: result.error };
      return { ok: true, written: result.blocksWritten, uidCloned: result.uidCloned };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('nfc:init', async () => {
    try {
      if (!NFCService) throw new Error('NFCService indisponible');
      if (nfcService) {
        return { success: true, readerName: nfcService.getReaderName(), mode: 'Gen2' };
      }

      nfcService = new NFCService();
      await nfcService.init();

      nfcService.onCardPresent((uid) => {
        BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('nfc:cardPresent', uid));
      });
      nfcService.onCardRemoved(() => {
        BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('nfc:cardRemoved'));
      });

      return { success: true, readerName: nfcService.getReaderName(), mode: 'Gen2' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nfc:isConnected', async () => {
    try {
      return !!(nfcService && nfcService.isConnected());
    } catch (_) {
      return false;
    }
  });

  ipcMain.handle('nfc:startPresenceWatch', async () => {
    try {
      return startPresenceWatcher();
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('nfc:stopPresenceWatch', async () => {
    try {
      stopPresenceWatcher();
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('nfc:readDump', async () => {
    try {
      // Python NFC engine (required): backend/nfc/dump.py
      const r = await runPythonDump();

      const out = (r && typeof r === 'object') ? { ...r } : r;

      // Sync to cloud when an admin captured a new dump (so clients can download it).
      try {
        if (out && out.success && out.dumpHex && authSessionUser && authSessionUser.role === 'admin') {
          try {
            await cloud.adminSetActiveDump({ dumpHex: String(out.dumpHex), uid: out.uid || null, source: 'direct' });
            emitAdminLog(`ACTIVE DUMP AUTO-PUBLISHED uid=${String(out.uid || '')}`);
            out.cloudPublish = { ok: true };
          } catch (e) {
            emitAdminLog(`ACTIVE DUMP AUTO-PUBLISH FAILED ${String(e && e.message || e)}`);
            out.cloudPublish = { ok: false, error: String(e && e.message || e) };
          }
        }
      } catch (_) {}

      // Client: upload a master dump to cloud (store on server).
      try {
        if (out && out.success && out.dumpHex && authSessionUser && authSessionUser.role === 'client') {
          try {
            const dump = await cloud.uploadMasterDump({ dumpHex: String(out.dumpHex), uid: out.uid || null });
            out.cloudUpload = { ok: true, dumpId: dump && dump.id != null ? Number(dump.id) : null };
          } catch (e) {
            out.cloudUpload = { ok: false, error: String(e && e.message || e) };
          }
        }
      } catch (_) {}

      return out;
    } catch (error) {
      const code = error && (error.code || error.message) ? String(error.code || error.message) : 'NFC_ERROR';
      return { success: false, error: code };
    }
  });

  // --- Dump: save active dump to cloud SQLite ---
  ipcMain.handle('dump:saveActive', async (_event, token, payload = {}) => {
    assertAdmin(token);
    const dumpHex = payload && payload.dumpHex;
    const uid = payload && payload.uid;
    const source = payload && payload.source;
    if (!dumpHex) return { success: false, error: 'missing_dump' };
    const r = await cloud.adminSetActiveDump({ dumpHex: String(dumpHex), uid: uid || null, source: source === 'direct' ? 'direct' : 'manual' });
    emitAdminLog(`ACTIVE DUMP SET uid=${uid || ''} source=${String(source || '')}`);
    return { success: true, dump: r };
  });

  // --- Dump: upload cached VAULT dump to cloud (client) ---
  ipcMain.handle('dump:uploadFromVault', async () => {
    try {
      if (!(authSessionUser && authSessionUser.role === 'client')) {
        return { success: false, error: 'client_required' };
      }
      if (!cloud || !cloud.token) return { success: false, error: 'not_authenticated' };

      const dumpPath = getUserVaultDumpPath();
      if (!fs.existsSync(dumpPath)) return { success: false, error: 'NO_DUMP', path: dumpPath };
      const buf = fs.readFileSync(dumpPath);
      if (!buf || buf.length < 1024) return { success: false, error: 'DUMP_TOO_SMALL', size: buf ? buf.length : 0 };

      const dumpHex = bufferToHex(buf.slice(0, 1024));
      const dump = await cloud.uploadMasterDump({ dumpHex, uid: null });
      return { success: true, dumpId: dump && dump.id != null ? Number(dump.id) : null };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('nfc:writeDump', async (_event, data) => {
    try {
      // Client flow: use Python writer (pyscard) from cached VAULT dump.
      if (authSessionUser && authSessionUser.role === 'client') {
        return await runPythonWriteFromVault();
      }

      if (!nfcService) return { success: false, error: 'NFC non initialisé' };

      return await nfcService.writeDump(data);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dumps:getQuota', async (_event, payload = {}) => {
    try {
      const q = await cloud.getQuota();
      // unify payload for existing UI
      const remaining = Number(q.remaining || 0);
      const monthlyLimit = Number(q.monthly_limit || 15);
      const used = q.copies_this_month != null ? Number(q.copies_this_month || 0) : Math.max(0, monthlyLimit - remaining);
      return { remaining, monthly_limit: monthlyLimit, copies_this_month: used, valid_until: q.valid_until || null };
    } catch (e) {
      return { remaining: 0, monthly_limit: 0, blocked: true, blocked_reason: String(e && e.message || e) };
    }
  });

  ipcMain.handle('dumps:getActiveDump', async (_event, clientId) => {
    // Spec order:
    // 1) Cloud first: GET /api/client/dump/active (Bearer + client-id)
    //    - If success: cache to userData/VAULT/SOURCE_ZERO.bin
    // 2) If cloud fails: fallback to local cache with warning
    // 3) If no local: return explicit error

    // Step 1 — Cloud
    try {
      const localMeta = readDumpMeta();
      const localHash = localMeta && localMeta.hash ? String(localMeta.hash) : null;
      const r = await fetchActiveDumpBinary({ clientId, ifNoneMatch: localHash });

      if (r && r.ok && r.notModified) {
        // Use local cached file (already latest)
        const dumpPath = getUserVaultDumpPath();
        if (fs.existsSync(dumpPath)) {
          const buf = fs.readFileSync(dumpPath);
          const hex = bufferToHex(buf.slice(0, 1024));
          return {
            success: true,
            source: 'cloud',
            data: hex,
            hash: localHash,
            lastSyncTs: Number(localMeta && localMeta.lastSyncTs || 0) || Date.now()
          };
        }
        // If file missing, force a full download next.
      } else if (r && r.ok && r.bytes) {
        const dumpPath = getUserVaultDumpPath();
        fs.writeFileSync(dumpPath, r.bytes);

        const meta = {
          hash: r.hash || sha256Hex(r.bytes),
          lastSyncTs: Date.now(),
          cloudUpdatedAt: r.updatedAt || null,
          source: 'cloud'
        };
        writeDumpMeta(meta);

        const hex = bufferToHex(r.bytes.slice(0, 1024));
        return {
          success: true,
          source: 'cloud',
          data: hex,
          hash: meta.hash,
          lastSyncTs: meta.lastSyncTs
        };
      }
    } catch (_) {
      // ignore and fall back
    }

    // Step 2 — Local fallback
    try {
      const dumpPath = getUserVaultDumpPath();
      if (fs.existsSync(dumpPath)) {
        const buf = fs.readFileSync(dumpPath);
        if (buf && buf.length >= 1024) {
          const meta = readDumpMeta();
          const hex = bufferToHex(buf.slice(0, 1024));
          return {
            success: true,
            source: 'local',
            warning: '⚠️ Mode hors ligne - dump local utilisé',
            data: hex,
            hash: meta && meta.hash ? String(meta.hash) : sha256Hex(buf.slice(0, 1024)),
            lastSyncTs: Number(meta && meta.lastSyncTs || 0) || 0
          };
        }
      }
    } catch (_) {
      // ignore
    }

    // Step 2b — Legacy project VAULT fallback (dev only)
    try {
      const legacy = path.join(getVaultDir(), 'SOURCE_ZERO.bin');
      if (fs.existsSync(legacy)) {
        const buf = fs.readFileSync(legacy);
        if (buf && buf.length >= 1024) {
          // Import into userData VAULT so the installed app always has a writable cache.
          try {
            const dumpPath = getUserVaultDumpPath();
            fs.writeFileSync(dumpPath, buf.slice(0, 1024));
            const st = (() => { try { return fs.statSync(legacy); } catch (_) { return null; } })();
            const meta = {
              hash: sha256Hex(buf.slice(0, 1024)),
              lastSyncTs: st && st.mtimeMs ? Math.round(st.mtimeMs) : Date.now(),
              cloudUpdatedAt: null,
              source: 'local-import'
            };
            writeDumpMeta(meta);
          } catch (_) {}

          const hex = bufferToHex(buf.slice(0, 1024));
          const meta2 = readDumpMeta();
          return {
            success: true,
            source: 'local',
            warning: '⚠️ Mode hors ligne - dump local utilisé',
            data: hex,
            hash: (meta2 && meta2.hash) ? String(meta2.hash) : sha256Hex(buf.slice(0, 1024)),
            lastSyncTs: Number(meta2 && meta2.lastSyncTs || 0) || 0
          };
        }
      }
    } catch (_) {}

    // Step 3 — Error
    return {
      success: false,
      error: 'Aucun dump disponible - connectez-vous à internet'
    };
  });

  ipcMain.handle('dumps:writeAdminDump', async (_event, payload = {}) => {
    try {
      const q = await cloud.decrementQuota();
      return { success: true, remaining: Number(q.remaining || 0), monthly_limit: Number(q.monthly_limit || 15), valid_until: q.valid_until || null };
    } catch (e) {
      return { success: false, message: String(e && e.message || e) };
    }
  });

  ipcMain.handle('dumps:logCopyFail', async () => {
    try {
      await cloud.logCopyFail();
      return { success: true };
    } catch (e) {
      return { success: false, message: String(e && e.message || e) };
    }
  });

  ipcMain.handle('cloud:isOnline', async () => {
    const online = await cloud.checkOnline();
    return { ok: true, online, baseUrl: cloud.baseUrl };
  });

  // --- Stats (dashboard) ---
  ipcMain.handle('stats:getStats', async () => {
    // Minimal implementation: quota from cloud + placeholders for recent copies.
    try {
      let q = cloud.cachedQuota;
      if (!q && cloud.token && cloud.role === 'client') {
        try { q = await cloud.getQuota(); } catch (_) {}
      }
      const remaining = Number(q && q.remaining || 0);
      const total = Math.max(1, Number(q && q.monthly_limit || 15));
      const used = Math.max(0, total - remaining);
      return {
        ok: true,
        stats: {
          copiesThisMonth: used,
          quotaRemaining: remaining,
          quotaTotal: total
        },
        recent: []
      };
    } catch (e) {
      return { ok: true, stats: { copiesThisMonth: 0, quotaRemaining: 0, quotaTotal: 0 }, recent: [] };
    }
  });
}

module.exports = { registerHandlers };
