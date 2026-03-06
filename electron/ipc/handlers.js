const { app, dialog, BrowserWindow } = require('electron');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { CloudClient } = require('../cloud/cloudClient');

const DUMP_DIR = path.join(os.tmpdir(), 'propass_dumps');
const VAULT_FILE = path.join(DUMP_DIR, 'SOURCE_ZERO.bin');
const LOCAL_LOGS_FILE = path.join(DUMP_DIR, 'local_admin_logs.json');

if (!fs.existsSync(DUMP_DIR)) {
  fs.mkdirSync(DUMP_DIR, { recursive: true });
}

const cloud = new CloudClient({ baseUrl: process.env.PROPASS_CLOUD_URL });
let authSessionUser = null;
let registered = false;
const adminLogs = [];
let nfcReaderConnected = false;
let nfcCardPresent = false;
let nfcCardUid = null;
let presenceWatcherChild = null;
let presenceWatcherBuf = '';
let dumpCliModeCache = null;
let smartCardServiceEnsured = false;
let NFCService = null;
let nfcService = null;
let nodeNfcListenersBound = false;

try {
  NFCService = require('../nfc/nfcService').NFCService;
} catch (_) {
  NFCService = null;
}

function shouldUseNodeNfcEngine() {
  const forced = String(process.env.PROPASS_NFC_ENGINE || '').trim().toLowerCase();
  if (forced === 'python') return false;
  if (forced === 'node') return !!NFCService;
  return process.platform === 'darwin' && !!NFCService;
}

function getNodeNfcState() {
  const readerConnected = !!(nfcService && nfcService.reader);
  const cardPresent = !!(nfcService && nfcService.isConnected && nfcService.isConnected());
  const uid = cardPresent ? (nfcService.currentUID || nfcCardUid || null) : null;
  return {
    connected: readerConnected,
    cardPresent,
    uid,
    readerName: readerConnected && nfcService.getReaderName ? nfcService.getReaderName() : null
  };
}

async function ensureNodeNfcReady() {
  if (!NFCService) {
    throw new Error('NFC_NODE_SERVICE_UNAVAILABLE');
  }
  if (!nfcService) {
    nfcService = new NFCService();
    await nfcService.init();
  }
  if (!nodeNfcListenersBound) {
    nfcService.onCardPresent((uid) => {
      emitCardPresent(uid || null);
      emitNfcLog(`[node] card present${uid ? ` uid=${String(uid)}` : ''}`);
    });
    nfcService.onCardRemoved(() => {
      emitCardRemoved();
      emitNfcLog('[node] card removed');
    });
    nfcService.onError((err) => {
      emitNfcLog(`[node][error] ${String(err && err.message || err || 'NFC_ERROR')}`);
    });
    nodeNfcListenersBound = true;
  }
  const st = getNodeNfcState();
  nfcReaderConnected = !!st.connected;
  if (!st.cardPresent) {
    nfcCardPresent = false;
    nfcCardUid = null;
  }
  return st;
}

function getDumpScriptPath() {
  const prodPath = path.join(process.resourcesPath || '', 'backend', 'nfc', 'dump.py');
  const devPath = path.join(__dirname, '..', '..', 'backend', 'nfc', 'dump.py');
  if (!app.isPackaged && fs.existsSync(devPath)) return devPath;
  if (fs.existsSync(prodPath)) return prodPath;
  return devPath;
}

function getWriteScriptPath() {
  const prodPath = path.join(process.resourcesPath || '', 'backend', 'nfc', 'write.py');
  const devPath = path.join(__dirname, '..', '..', 'backend', 'nfc', 'write.py');
  if (!app.isPackaged && fs.existsSync(devPath)) return devPath;
  if (fs.existsSync(prodPath)) return prodPath;
  return devPath;
}

function getPresenceWatchScriptPath() {
  const prodPath = path.join(process.resourcesPath || '', 'backend', 'nfc', 'presence_watch.py');
  const devPath = path.join(__dirname, '..', '..', 'backend', 'nfc', 'presence_watch.py');
  if (!app.isPackaged && fs.existsSync(devPath)) return devPath;
  if (fs.existsSync(prodPath)) return prodPath;
  return devPath;
}

function getDumpCliMode() {
  if (dumpCliModeCache) return dumpCliModeCache;
  const scriptPath = getDumpScriptPath();
  try {
    const txt = fs.readFileSync(scriptPath, 'utf8');
    if (txt.includes('--from-vault') || txt.includes('argparse.ArgumentParser')) {
      dumpCliModeCache = 'argparse';
      return dumpCliModeCache;
    }
  } catch (_) {}
  dumpCliModeCache = 'legacy';
  return dumpCliModeCache;
}

function getBundledPythonCandidates() {
  const base = process.resourcesPath || '';
  const candidates = [];

  if (process.platform === 'win32') {
    candidates.push(path.join(base, 'python', 'python.exe'));
    candidates.push(path.join(base, 'backend', 'python', 'python.exe'));
    candidates.push(path.join(base, 'runtime', 'python', 'python.exe'));
  } else {
    candidates.push(path.join(base, 'python', 'bin', 'python3'));
    candidates.push(path.join(base, 'backend', 'python', 'bin', 'python3'));
    candidates.push(path.join(base, 'runtime', 'python', 'bin', 'python3'));
  }

  return candidates;
}

function resolvePythonBin() {
  const envBin = String(process.env.PROPASS_PYTHON_BIN || '').trim();
  if (envBin && fs.existsSync(envBin)) return envBin;

  const bundled = getBundledPythonCandidates();
  for (const p of bundled) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

function ensureSmartCardService() {
  if (process.platform !== 'win32') return;
  if (smartCardServiceEnsured) return;
  smartCardServiceEnsured = true;

  try {
    const ps = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "try { Set-Service -Name SCardSvr -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name SCardSvr -ErrorAction SilentlyContinue } catch {}"
    ];
    spawnSync('powershell', ps, { windowsHide: true, timeout: 5000 });
  } catch (_) {}
}

function probeReaderConnection() {
  return new Promise((resolve) => {
    ensureSmartCardService();
    const pythonBin = resolvePythonBin();
    const detectScript = `
import sys
try:
    from smartcard.System import readers
    r = readers()
    if r:
        print("READER_OK:" + str(r[0]), flush=True)
        sys.exit(0)
    else:
        print("NO_READER", flush=True)
        sys.exit(1)
except Exception as e:
    print("ERROR:" + str(e), flush=True)
    sys.exit(2)
`;

    const child = spawn(pythonBin, ['-c', detectScript]);
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('close', (code) => {
      const connected = code === 0 && output.includes('READER_OK');
      const readerName = connected ? (output.split('READER_OK:')[1] || '').trim() || 'Lecteur PCSC' : null;
      resolve({ connected, readerName, raw: output.trim() });
    });
    child.on('error', () => resolve({ connected: false, readerName: null, raw: `python_not_found:${pythonBin}` }));
  });
}

function runDumpScript(action, target, sender, options = {}) {
  const scriptPath = getDumpScriptPath();
  const writePath = getWriteScriptPath();
  const pythonBin = resolvePythonBin();
  const extraEnv = (options && options.env && typeof options.env === 'object') ? options.env : {};

  const compactPyErr = (stderrAll) => {
    const txt = String(stderrAll || '');
    const lines = txt
      .split(/\r?\n/)
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    if (!lines.length) return '';
    const last = String(lines[lines.length - 1] || '');
    return last.length > 220 ? `${last.slice(0, 220)}…` : last;
  };

  const spawnAndStream = (script, args, envExtra = {}) => new Promise((resolve, reject) => {
    if (!fs.existsSync(script)) {
      reject(new Error(`SCRIPT_NOT_FOUND: ${script}`));
      return;
    }

    let stderrAll = '';
    const child = spawn(pythonBin, [script, ...args], {
      env: { ...process.env, PYTHONUNBUFFERED: '1', ...envExtra }
    });

    child.stdout.on('data', (chunk) => {
      const line = String(chunk || '').trim();
      if (line && sender && !sender.isDestroyed()) {
        sender.send('nfc:log', line);
        sender.send('nfc:pyLog', line);
      }
      if (line) console.log(`[py][stdout] ${line}`);
    });

    child.stderr.on('data', (chunk) => {
      const line = String(chunk || '').trim();
      stderrAll += `${line}\n`;
      if (line && sender && !sender.isDestroyed()) {
        sender.send('nfc:log', `ERR: ${line}`);
        sender.send('nfc:pyLog', `ERR: ${line}`);
      }
      if (line) console.error(`[py][stderr] ${line}`);
    });

    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, code: 0, stderr: stderrAll });
      else resolve({ ok: false, code: Number(code || 1), stderr: stderrAll });
    });

    child.on('error', (err) => reject(new Error(`SPAWN_ERROR: ${err.message}`)));
  });

  return (async () => {
    const cliMode = getDumpCliMode();

    if (action === 'read') {
      if (cliMode === 'argparse') {
        const r = await spawnAndStream(scriptPath, ['--out', target]);
        if (r.ok) return;
        const detail = compactPyErr(r.stderr);
        throw new Error(`DUMP_SCRIPT_FAILED: exit code ${r.code}${detail ? ` (${detail})` : ''}`);
      }

      const r1 = await spawnAndStream(scriptPath, ['read', target]);
      if (r1.ok) return;

      const needsArgStyle = /unrecognized arguments|usage:\s*dump\.py/i.test(String(r1.stderr || ''));
      if (needsArgStyle) {
        const r2 = await spawnAndStream(scriptPath, ['--out', target]);
        if (r2.ok) return;
        const detail = compactPyErr(r2.stderr);
        throw new Error(`DUMP_SCRIPT_FAILED: exit code ${r2.code}${detail ? ` (${detail})` : ''}`);
      }
      {
        const detail = compactPyErr(r1.stderr);
        throw new Error(`DUMP_SCRIPT_FAILED: exit code ${r1.code}${detail ? ` (${detail})` : ''}`);
      }
    }

    if (action === 'write') {
      if (cliMode === 'argparse') {
        const r = await spawnAndStream(writePath, [], { PROPASS_SOURCE_PATH: target, ...extraEnv });
        if (r.ok) return;
        const detail = compactPyErr(r.stderr);
        throw new Error(`WRITE_SCRIPT_FAILED: exit code ${r.code}${detail ? ` (${detail})` : ''}`);
      }

      const r1 = await spawnAndStream(scriptPath, ['write', target]);
      if (r1.ok) return;

      const needsWriteFallback = /unrecognized arguments|usage:\s*dump\.py/i.test(String(r1.stderr || ''));
      if (needsWriteFallback) {
        const r2 = await spawnAndStream(writePath, [], { PROPASS_SOURCE_PATH: target, ...extraEnv });
        if (r2.ok) return;
        const detail = compactPyErr(r2.stderr);
        throw new Error(`WRITE_SCRIPT_FAILED: exit code ${r2.code}${detail ? ` (${detail})` : ''}`);
      }
      {
        const detail = compactPyErr(r1.stderr);
        throw new Error(`DUMP_SCRIPT_FAILED: exit code ${r1.code}${detail ? ` (${detail})` : ''}`);
      }
    }

    throw new Error(`UNSUPPORTED_ACTION: ${String(action)}`);
  })();
}

function getAllWindows() {
  try {
    return BrowserWindow.getAllWindows() || [];
  } catch (_) {
    return [];
  }
}

function broadcast(channel, payload) {
  const wins = getAllWindows();
  for (const w of wins) {
    try {
      if (w && w.webContents && !w.webContents.isDestroyed()) {
        w.webContents.send(channel, payload);
      }
    } catch (_) {}
  }
}

function nowFr() {
  return new Date().toLocaleString('fr-FR');
}

function emitAdminLog(line) {
  const msg = `[${nowFr()}] ${String(line || '')}`;
  adminLogs.push(msg);
  if (adminLogs.length > 500) adminLogs.splice(0, adminLogs.length - 500);
  broadcast('admin:log', msg);
}

function readLocalLogs() {
  try {
    if (!fs.existsSync(LOCAL_LOGS_FILE)) return [];
    const raw = fs.readFileSync(LOCAL_LOGS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function writeLocalLogs(rows) {
  try {
    fs.writeFileSync(LOCAL_LOGS_FILE, JSON.stringify(Array.isArray(rows) ? rows : [], null, 2), 'utf8');
  } catch (_) {}
}

function appendLocalLog(action, companyName) {
  const rows = readLocalLogs();
  rows.unshift({
    id: `L${Date.now()}${Math.floor(Math.random() * 1000)}`,
    ts: Date.now(),
    action: String(action || '—'),
    company_name: String(companyName || '—')
  });
  writeLocalLogs(rows.slice(0, 3000));
}

function filterLocalLogs(filters = {}) {
  const actionFilter = String(filters.action || '').trim();
  const societeFilter = String(filters.societe || '').trim().toLowerCase();
  const start = filters.dateDebut ? new Date(`${filters.dateDebut}T00:00:00`).getTime() : null;
  const end = filters.dateFin ? new Date(`${filters.dateFin}T23:59:59`).getTime() : null;

  return readLocalLogs().filter((r) => {
    const ts = Number(r.ts || 0);
    if (start != null && ts < start) return false;
    if (end != null && ts > end) return false;
    if (actionFilter && actionFilter !== 'Tous' && String(r.action || '') !== actionFilter) return false;
    if (societeFilter && !String(r.company_name || '').toLowerCase().includes(societeFilter)) return false;
    return true;
  });
}

async function buildMergedLogs(filters = {}) {
  const localRows = filterLocalLogs(filters);

  let cloudRows = [];
  let cloudTotal = 0;
  try {
    const r = await cloud.adminGetLogs({ ...filters, page: 1, limit: 1000 });
    cloudRows = Array.isArray(r.rows) ? r.rows : [];
    cloudTotal = Number(r.total || cloudRows.length || 0);
  } catch (_) {
    cloudRows = [];
    cloudTotal = 0;
  }

  const all = [...cloudRows, ...localRows]
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));

  const page = Math.max(1, Number(filters.page || 1));
  const limit = Math.max(1, Math.min(5000, Number(filters.limit || 10)));
  const total = Math.max(cloudTotal, all.length);
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const startIdx = (page - 1) * limit;
  const rows = all.slice(startIdx, startIdx + limit);

  return { rows, total, pageCount, page, limit };
}

function resolveCompanyNameFromUser(u) {
  if (!u) return '—';
  return String(u.company_name || u.company || u.username || u.email || '—');
}

function expandDump768To1024(buf768) {
  const src = Buffer.isBuffer(buf768) ? buf768 : Buffer.from(buf768 || []);
  if (src.length !== 768) throw new Error('INVALID_768_DUMP');
  const out = Buffer.alloc(1024, 0x00);
  const passOmega = Buffer.from([0xEF, 0x61, 0xA3, 0xD4, 0x8E, 0x2A]);
  const access = Buffer.from([0xFF, 0x07, 0x80, 0x69]);
  for (let sector = 0; sector < 16; sector++) {
    const srcOffset = sector * 48;
    const dstOffset = sector * 64;
    src.copy(out, dstOffset, srcOffset, srcOffset + 48);
    const trailerOffset = dstOffset + 48;
    passOmega.copy(out, trailerOffset, 0, 6);
    access.copy(out, trailerOffset + 6, 0, 4);
    passOmega.copy(out, trailerOffset + 10, 0, 6);
  }
  return out;
}

function compressDump1024To768(buf1024) {
  const src = Buffer.isBuffer(buf1024) ? buf1024 : Buffer.from(buf1024 || []);
  if (src.length !== 1024) throw new Error('INVALID_1024_DUMP');
  const out = Buffer.alloc(768);
  for (let sector = 0; sector < 16; sector++) {
    const srcOffset = sector * 64;
    const dstOffset = sector * 48;
    src.copy(out, dstOffset, srcOffset, srcOffset + 48);
  }
  return out;
}

function normalizeDumpForCloudHex(buf) {
  const src = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (src.length === 1024) return src.toString('hex');
  if (src.length === 768) return expandDump768To1024(src).toString('hex');
  if (src.length > 1024) return src.subarray(0, 1024).toString('hex');
  throw new Error(`UNSUPPORTED_DUMP_SIZE:${src.length}`);
}

function writeVaultForWriterFromHex(dumpHex) {
  const h = String(dumpHex || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (!h || (h.length % 2) !== 0) throw new Error('DUMP_HEX_INVALID');
  const raw = Buffer.from(h, 'hex');
  if (raw.length === 768) {
    const full = expandDump768To1024(raw);
    fs.writeFileSync(VAULT_FILE, full);
    return 1024;
  }
  if (raw.length >= 1024) {
    const w = raw.subarray(0, 1024);
    fs.writeFileSync(VAULT_FILE, w);
    return 1024;
  }
  throw new Error(`DUMP_SIZE_INVALID:${raw.length}`);
}

function emitNfcLog(line) {
  const msg = String(line == null ? '' : line).trim();
  if (!msg) return;
  broadcast('nfc:log', msg);
  broadcast('nfc:pyLog', msg);
}

function emitCardPresent(uid) {
  const v = uid == null ? null : String(uid);
  nfcCardPresent = true;
  nfcCardUid = v;
  broadcast('nfc:cardPresent', v);
}

function emitCardRemoved() {
  nfcCardPresent = false;
  nfcCardUid = null;
  broadcast('nfc:cardRemoved');
}

function stopPresenceWatcher() {
  try {
    if (presenceWatcherChild && !presenceWatcherChild.killed) {
      presenceWatcherChild.kill();
    }
  } catch (_) {}
  presenceWatcherChild = null;
  presenceWatcherBuf = '';
}

function startPresenceWatcher() {
  return new Promise((resolve) => {
    ensureSmartCardService();
    if (presenceWatcherChild && !presenceWatcherChild.killed) {
      resolve({ success: true, watching: true, connected: nfcReaderConnected });
      return;
    }

    const scriptPath = getPresenceWatchScriptPath();
    if (!fs.existsSync(scriptPath)) {
      resolve({ success: false, error: `SCRIPT_NOT_FOUND: ${scriptPath}` });
      return;
    }

    const pythonBin = resolvePythonBin();
    let resolved = false;

    try {
      presenceWatcherChild = spawn(pythonBin, [scriptPath], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
      presenceWatcherBuf = '';
    } catch (e) {
      resolve({ success: false, error: String(e && e.message || e) });
      return;
    }

    const finish = (payload) => {
      if (resolved) return;
      resolved = true;
      resolve(payload);
    };

    const handleLine = (line) => {
      const s = String(line || '').trim();
      if (!s) return;

      let obj = null;
      try { obj = JSON.parse(s); } catch (_) { obj = null; }
      if (!obj || typeof obj !== 'object') {
        emitNfcLog(s);
        return;
      }

      const t = String(obj.type || '').toLowerCase();
      if (t === 'ready') {
        nfcReaderConnected = true;
        emitNfcLog('[watch] ready');
        finish({ success: true, watching: true, connected: true });
        return;
      }

      if (t === 'present') {
        nfcReaderConnected = true;
        emitCardPresent(obj.uid || null);
        emitNfcLog(`[watch] card present${obj.uid ? ` uid=${String(obj.uid)}` : ''}`);
        return;
      }

      if (t === 'removed') {
        nfcReaderConnected = true;
        emitCardRemoved();
        emitNfcLog('[watch] card removed');
        return;
      }

      if (t === 'error') {
        const code = String(obj.error || 'WATCHER_ERROR');
        emitNfcLog(`[watch] error ${code}`);
        if (code === 'NO_READER') {
          nfcReaderConnected = false;
          emitCardRemoved();
        }
        finish({ success: false, error: code, connected: nfcReaderConnected });
      }
    };

    presenceWatcherChild.stdout.on('data', (chunk) => {
      presenceWatcherBuf += String(chunk || '');
      const parts = presenceWatcherBuf.split(/\r?\n/);
      presenceWatcherBuf = parts.pop() || '';
      for (const ln of parts) handleLine(ln);
    });

    presenceWatcherChild.stderr.on('data', (chunk) => {
      const line = String(chunk || '').trim();
      if (line) emitNfcLog(`[watch][stderr] ${line}`);
    });

    presenceWatcherChild.on('close', (code) => {
      presenceWatcherChild = null;
      presenceWatcherBuf = '';
      if (!resolved) {
        finish({ success: false, error: `WATCHER_EXIT_${Number(code || 0)}` });
      }
    });

    presenceWatcherChild.on('error', (e) => {
      presenceWatcherChild = null;
      presenceWatcherBuf = '';
      finish({ success: false, error: String(e && e.message || e || 'WATCHER_SPAWN_ERROR') });
    });

    setTimeout(() => {
      if (!resolved) {
        finish({ success: true, watching: true, connected: nfcReaderConnected });
      }
    }, 1200);
  });
}

function registerHandlers(ipcMain) {
  if (registered) return;
  registered = true;

  cloud.on('quota:update', (q) => {
    broadcast('cloud:quotaUpdate', q || null);
  });

  ipcMain.handle('cloud:isOnline', async () => {
    try {
      const online = await cloud.checkOnline();
      return { ok: true, online: !!online };
    } catch (_) {
      return { ok: true, online: false };
    }
  });

  ipcMain.handle('auth:login', async (_event, username, password) => {
    try {
      const r = await cloud.login(String(username || ''), String(password || ''));
      const u = (r && (r.client || r.user)) || {};
      authSessionUser = {
        id: u.id || null,
        username: u.username || String(username || ''),
        email: u.email || null,
        company_name: u.company_name || u.company || null,
        role: String(r.role || (r.client ? 'client' : 'admin') || 'client')
      };
      emitAdminLog(`LOGIN ${authSessionUser.role} ${authSessionUser.username}`);
      return { success: true, token: r.token, user: authSessionUser };
    } catch (e) {
      return { success: false, error: String(e && e.message || e || 'login_failed') };
    }
  });

  ipcMain.handle('auth:restoreSession', async (_event, payload = {}) => {
    try {
      const token = payload && payload.token ? String(payload.token) : null;
      const u = payload && payload.user ? payload.user : null;
      if (!token || !u) return { success: false, error: 'invalid_session_payload' };

      cloud.token = token;
      cloud.role = String(u.role || 'client');
      cloud.username = String(u.username || '');

      authSessionUser = {
        id: u.id || null,
        username: u.username || '',
        email: u.email || null,
        company_name: u.company_name || u.company || null,
        role: String(u.role || 'client')
      };

      if (authSessionUser.role === 'client') {
        try {
          const q = await cloud.getQuota();
          broadcast('cloud:quotaUpdate', q || null);
        } catch (e) {
          try { cloud.logout(); } catch (_) {}
          authSessionUser = null;
          return { success: false, error: `session_invalid:${String(e && e.message || e || 'quota_failed')}` };
        }
      } else if (authSessionUser.role === 'admin') {
        try {
          await cloud.adminGetStats();
        } catch (e) {
          try { cloud.logout(); } catch (_) {}
          authSessionUser = null;
          return { success: false, error: `session_invalid:${String(e && e.message || e || 'admin_probe_failed')}` };
        }
      }

      return { success: true, user: authSessionUser };
    } catch (e) {
      return { success: false, error: String(e && e.message || e || 'restore_failed') };
    }
  });

  ipcMain.handle('auth:getCurrentUser', async () => authSessionUser || null);

  ipcMain.handle('auth:logout', async () => {
    try { cloud.logout(); } catch (_) {}
    authSessionUser = null;
    return { success: true };
  });

  ipcMain.handle('auth:requestReset', async (_event, payload = {}) => {
    try {
      const username = String(payload && payload.username || '').trim();
      if (!username) return { success: false, error: 'username_required' };
      await cloud.requestPasswordReset(username);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('auth:confirmReset', async (_event, payload = {}) => {
    try {
      const token = String(payload && payload.token || '').trim();
      const newPassword = String(payload && payload.newPassword || '').trim();
      if (!token || !newPassword) return { success: false, error: 'invalid_payload' };
      await cloud.confirmPasswordReset(token, newPassword);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('nfc:init', async () => {
    try {
      if (shouldUseNodeNfcEngine()) {
        const st = await ensureNodeNfcReady();
        return { connected: st.connected, readerName: st.readerName, cardPresent: st.cardPresent, uid: st.uid, success: true };
      }
      const r = await probeReaderConnection();
      nfcReaderConnected = !!r.connected;
      if (!r.connected) emitCardRemoved();
      return r;
    } catch (e) {
      return { connected: false, readerName: null, raw: String(e && e.message || e) };
    }
  });

  ipcMain.handle('nfc:isConnected', async () => {
    if (shouldUseNodeNfcEngine()) {
      try {
        const st = await ensureNodeNfcReady();
        return {
          success: true,
          connected: !!st.connected,
          cardPresent: !!st.cardPresent,
          uid: st.uid || null
        };
      } catch (_) {
        nfcReaderConnected = false;
        emitCardRemoved();
        return { success: true, connected: false, cardPresent: false, uid: null };
      }
    }

    try {
      const r = await probeReaderConnection();
      nfcReaderConnected = !!r.connected;
      if (!r.connected) emitCardRemoved();
    } catch (_) {
      nfcReaderConnected = false;
      emitCardRemoved();
    }

    return {
      success: true,
      connected: !!nfcReaderConnected,
      cardPresent: !!nfcCardPresent,
      uid: nfcCardUid || null
    };
  });

  ipcMain.handle('nfc:startPresenceWatch', async () => {
    try {
      if (shouldUseNodeNfcEngine()) {
        const st = await ensureNodeNfcReady();
        return { success: true, watching: true, connected: !!st.connected };
      }
      return await startPresenceWatcher();
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('nfc:stopPresenceWatch', async () => {
    if (shouldUseNodeNfcEngine()) {
      return { success: true };
    }
    stopPresenceWatcher();
    return { success: true };
  });

  ipcMain.handle('nfc:readDump', async (event) => {
    const sender = event.sender;
    try {
      if (shouldUseNodeNfcEngine()) {
        if (sender && !sender.isDestroyed()) sender.send('nfc:log', '[READ] Pose le badge SOURCE sur le lecteur…');
        await ensureNodeNfcReady();
        if (nfcService && nfcService.waitForCardPresent) {
          await nfcService.waitForCardPresent(25000);
        }

        const nodeResult = await nfcService.readDump();
        if (!nodeResult || !nodeResult.success || !nodeResult.dump) {
          throw new Error(String(nodeResult && nodeResult.error || 'READ_FAILED'));
        }

        fs.writeFileSync(VAULT_FILE, Buffer.from(nodeResult.dump));
        const stats = fs.statSync(VAULT_FILE);

        let syncedToServer = false;
        let syncError = null;
        try {
          const rawDump = fs.readFileSync(VAULT_FILE);
          const dumpHexForCloud = normalizeDumpForCloudHex(rawDump);
          const uid = rawDump.length >= 4 ? rawDump.subarray(0, 4).toString('hex').toUpperCase() : null;

          if (authSessionUser && authSessionUser.role === 'admin') {
            await cloud.adminSetActiveDump({ dumpHex: dumpHexForCloud, uid, source: 'direct' });
            syncedToServer = true;
            emitAdminLog(`EXTRACTION_SYNC_OK admin=${authSessionUser.username} size=${rawDump.length}`);
            const payload = { source: 'cloud', uid, ts: Date.now() };
            broadcast('dumps:dumpUpdated', payload);
            broadcast('dump:updated', payload);
          }
        } catch (e) {
          syncError = String(e && e.message || e || 'sync_failed');
        }

        if (sender && !sender.isDestroyed()) sender.send('nfc:log', `[READ] ✅ Dump sauvegardé (${stats.size} bytes)`);
        if (authSessionUser && authSessionUser.role === 'admin' && !syncedToServer) {
          return {
            success: false,
            error: `SYNC_SERVER_FAILED: ${syncError || 'unknown'}`,
            vaultPath: VAULT_FILE,
            size: stats.size,
            synced: false
          };
        }
        return { success: true, vaultPath: VAULT_FILE, size: stats.size, synced: syncedToServer };
      }

      if (sender && !sender.isDestroyed()) sender.send('nfc:log', '[READ] Pose le badge SOURCE sur le lecteur…');
      await runDumpScript('read', VAULT_FILE, sender);
      if (!fs.existsSync(VAULT_FILE)) throw new Error('VAULT_EMPTY');
      const stats = fs.statSync(VAULT_FILE);

      let syncedToServer = false;
      let syncError = null;
      try {
        const rawDump = fs.readFileSync(VAULT_FILE);
        const dumpHexForCloud = normalizeDumpForCloudHex(rawDump);
        const uid = rawDump.length >= 4 ? rawDump.subarray(0, 4).toString('hex').toUpperCase() : null;

        if (authSessionUser && authSessionUser.role === 'admin') {
          await cloud.adminSetActiveDump({ dumpHex: dumpHexForCloud, uid, source: 'direct' });
          syncedToServer = true;
          emitAdminLog(`EXTRACTION_SYNC_OK admin=${authSessionUser.username} size=${rawDump.length}`);
          const payload = { source: 'cloud', uid, ts: Date.now() };
          broadcast('dumps:dumpUpdated', payload);
          broadcast('dump:updated', payload);
        }
      } catch (e) {
        syncError = String(e && e.message || e || 'sync_failed');
      }

      if (sender && !sender.isDestroyed()) sender.send('nfc:log', `[READ] ✅ Dump sauvegardé (${stats.size} bytes)`);
      if (authSessionUser && authSessionUser.role === 'admin' && !syncedToServer) {
        return {
          success: false,
          error: `SYNC_SERVER_FAILED: ${syncError || 'unknown'}`,
          vaultPath: VAULT_FILE,
          size: stats.size,
          synced: false
        };
      }
      return { success: true, vaultPath: VAULT_FILE, size: stats.size, synced: syncedToServer };
    } catch (e) {
      if (sender && !sender.isDestroyed()) sender.send('nfc:log', `[READ] ❌ ${String(e && e.message || e)}`);
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('nfc:writeDump', async (event, hex) => {
    const sender = event.sender;
    let restartWatcherAfterWrite = false;
    try {
      if (shouldUseNodeNfcEngine()) {
        if (hex != null) {
          writeVaultForWriterFromHex(hex);
        }
        if (!fs.existsSync(VAULT_FILE)) {
          throw new Error('VAULT_MISSING: dump source absent');
        }

        if (sender && !sender.isDestroyed()) sender.send('nfc:log', '[WRITE] Pose le badge CIBLE sur le lecteur…');
        await ensureNodeNfcReady();
        if (nfcService && nfcService.waitForCardPresent) {
          await nfcService.waitForCardPresent(25000);
        }

        const raw = fs.readFileSync(VAULT_FILE);
        const dumpHex = normalizeDumpForCloudHex(raw);
        const wr = await nfcService.writeDump(dumpHex);
        if (!wr || !wr.success) {
          throw new Error(String(wr && wr.error || 'WRITE_FAILED'));
        }
        if (sender && !sender.isDestroyed()) sender.send('nfc:log', '[WRITE] ✅ Badge copié avec succès');
        return { success: true, ...wr };
      }

      if (hex != null) {
        writeVaultForWriterFromHex(hex);
      }

      if (!fs.existsSync(VAULT_FILE)) {
        throw new Error('VAULT_MISSING: dump source absent');
      }

      if (presenceWatcherChild && !presenceWatcherChild.killed) {
        restartWatcherAfterWrite = true;
        stopPresenceWatcher();
      }

      if (sender && !sender.isDestroyed()) sender.send('nfc:log', '[WRITE] Pose le badge CIBLE sur le lecteur…');
      await runDumpScript('write', VAULT_FILE, sender);
      if (sender && !sender.isDestroyed()) sender.send('nfc:log', '[WRITE] ✅ Badge copié avec succès');
      return { success: true };
    } catch (e) {
      if (sender && !sender.isDestroyed()) sender.send('nfc:log', `[WRITE] ❌ ${String(e && e.message || e)}`);
      return { success: false, error: String(e && e.message || e) };
    } finally {
      if (restartWatcherAfterWrite) {
        try {
          await startPresenceWatcher();
        } catch (_) {}
      }
    }
  });

  ipcMain.handle('nfc:writeDumpMagic', async (event, hex) => {
    const sender = event.sender;
    let restartWatcherAfterWrite = false;
    try {
      if (shouldUseNodeNfcEngine()) {
        if (hex != null) {
          writeVaultForWriterFromHex(hex);
        }
        if (!fs.existsSync(VAULT_FILE)) {
          throw new Error('VAULT_MISSING: dump source absent');
        }
        if (sender && !sender.isDestroyed()) sender.send('nfc:log', '[WRITE][MAGIC] Mode Python indisponible sur macOS, fallback écriture standard');

        await ensureNodeNfcReady();
        if (nfcService && nfcService.waitForCardPresent) {
          await nfcService.waitForCardPresent(25000);
        }

        const raw = fs.readFileSync(VAULT_FILE);
        const dumpHex = normalizeDumpForCloudHex(raw);
        const wr = await nfcService.writeDump(dumpHex);
        if (!wr || !wr.success) {
          throw new Error(String(wr && wr.error || 'WRITE_FAILED'));
        }
        return { success: true, magic: false, ...wr };
      }

      if (hex != null) {
        writeVaultForWriterFromHex(hex);
      }

      if (!fs.existsSync(VAULT_FILE)) {
        throw new Error('VAULT_MISSING: dump source absent');
      }

      if (presenceWatcherChild && !presenceWatcherChild.killed) {
        restartWatcherAfterWrite = true;
        stopPresenceWatcher();
      }

      if (sender && !sender.isDestroyed()) sender.send('nfc:log', '[WRITE][MAGIC] Pose le badge CIBLE sur le lecteur…');
      await runDumpScript('write', VAULT_FILE, sender, { env: { PROPASS_WRITE_MAGIC_UID: '1' } });
      if (sender && !sender.isDestroyed()) sender.send('nfc:log', '[WRITE][MAGIC] ✅ Badge copié avec UID (mode magic)');
      return { success: true, magic: true };
    } catch (e) {
      if (sender && !sender.isDestroyed()) sender.send('nfc:log', `[WRITE][MAGIC] ❌ ${String(e && e.message || e)}`);
      return { success: false, error: String(e && e.message || e), magic: true };
    } finally {
      if (restartWatcherAfterWrite) {
        try {
          await startPresenceWatcher();
        } catch (_) {}
      }
    }
  });

  ipcMain.handle('nfc:clearVault', async () => {
    try {
      if (fs.existsSync(VAULT_FILE)) fs.unlinkSync(VAULT_FILE);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('nfc:vaultExists', async () => {
    const exists = fs.existsSync(VAULT_FILE);
    const size = exists ? fs.statSync(VAULT_FILE).size : 0;
    return { exists, size, path: VAULT_FILE };
  });

  ipcMain.handle('dumps:getQuota', async () => {
    try {
      const q = await cloud.getQuota();
      return { success: true, ...q };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('dumps:getActiveDump', async () => {
    try {
      const d = await cloud.getActiveDumpToCopy();
      const dumpHex = String(d && d.dumpHex || '');
      writeVaultForWriterFromHex(dumpHex);
      const createdAtMs = Date.parse(String(d && d.createdAt || ''));
      return {
        success: true,
        source: 'cloud',
        data: dumpHex,
        uid: d && d.uid || null,
        createdAt: d && d.createdAt || null,
        lastSyncTs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now()
      };
    } catch (e) {
      try {
        if (fs.existsSync(VAULT_FILE)) {
          const buf = fs.readFileSync(VAULT_FILE);
          const dumpHex = normalizeDumpForCloudHex(buf);
          if (dumpHex.length >= 1536) {
            return {
              success: true,
              source: 'local',
              warning: '⚠️ Mode hors ligne - dump local utilisé',
              data: dumpHex,
              lastSyncTs: 0
            };
          }
        }
      } catch (_) {}
      return { success: false, error: String(e && e.message || e || 'no_active_dump') };
    }
  });

  ipcMain.handle('dumps:syncNow', async () => {
    try {
      const d = await cloud.getActiveDumpToCopy();
      const dumpHex = String(d && d.dumpHex || '');
      if (dumpHex && dumpHex.length >= 1536) {
        writeVaultForWriterFromHex(dumpHex);
        const payload = { source: 'cloud', uid: d && d.uid || null, ts: Date.now() };
        broadcast('dumps:dumpUpdated', payload);
        broadcast('dump:updated', payload);
        return { success: true, updated: true, source: 'cloud' };
      }
      return { success: false, error: 'DUMP_HEX_INVALID' };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('dumps:writeAdminDump', async () => {
    if (!(authSessionUser && authSessionUser.role === 'client')) {
      return { success: false, error: 'client_required' };
    }
    try {
      const q = await cloud.decrementQuota();
      broadcast('cloud:quotaUpdate', q || null);
      const company = resolveCompanyNameFromUser(authSessionUser);
      appendLocalLog('Copié', company);
      emitAdminLog(`COPIE client=${authSessionUser.username} remaining=${Number(q && q.remaining || 0)}`);
      return { success: true, quota: q };
    } catch (e) {
      try { await cloud.logCopyFail(); } catch (_) {}
      const company = resolveCompanyNameFromUser(authSessionUser);
      appendLocalLog('Échec copie', company);
      emitAdminLog(`ECHEC_COPIE client=${authSessionUser.username} reason=${String(e && e.message || e)}`);
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('dumps:logCopyFail', async () => {
    try { await cloud.logCopyFail(); } catch (_) {}
    const company = resolveCompanyNameFromUser(authSessionUser);
    appendLocalLog('Échec copie', company);
    emitAdminLog(`ECHEC_COPIE client=${authSessionUser && authSessionUser.username || 'unknown'}`);
    return { success: true };
  });

  ipcMain.handle('admin:getSessionToken', async () => {
    if (!(authSessionUser && authSessionUser.role === 'admin' && cloud.token)) {
      return { success: false, error: 'admin_required' };
    }
    return { success: true, token: cloud.token };
  });

  ipcMain.handle('admin:listClients', async () => {
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

  ipcMain.handle('admin:addQuota', async (_event, _token, payload = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const clientId = payload && payload.clientId;
      const username = payload && payload.username;
      const addQuota = Number(payload && payload.addQuota || 0);
      const row = await cloud.adminAddQuota({ clientId, username, addQuota, validityDays: 30 });
      const company = String(row && (row.company_name || row.company || row.username || row.id) || '—');
      appendLocalLog(`Recharge quota (+${addQuota})`, company);
      emitAdminLog(`RECHARGE client=${company} +${addQuota} remaining=${Number(row && row.quota_remaining || 0)}`);
      return { success: true, client: row };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:getStats', async () => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const stats = await cloud.adminGetStats();
      let totalCopies = Number(stats && stats.totalCopies || 0);
      try {
        const logs = await cloud.adminGetLogs({ action: 'Copié', page: 1, limit: 1 });
        const fromLogs = Number(logs && logs.total || 0);
        if (Number.isFinite(fromLogs) && fromLogs > totalCopies) totalCopies = fromLogs;
      } catch (_) {}
      return {
        success: true,
        stats: {
          totalClients: Number(stats && stats.totalClients || 0),
          totalCopies: Number.isFinite(totalCopies) ? totalCopies : 0
        }
      };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:getCopyStats', async (_event, period) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const mode = String(period || 'monthly') === 'weekly' ? 'weekly' : 'monthly';
      const stats = await cloud.adminGetCopyStats(mode);
      const totalSuccess = (Array.isArray(stats && stats.success) ? stats.success : []).reduce((a, b) => a + Number(b || 0), 0);
      const totalFail = (Array.isArray(stats && stats.fail) ? stats.fail : []).reduce((a, b) => a + Number(b || 0), 0);

      if ((totalSuccess + totalFail) > 0) {
        return { success: true, ...stats };
      }

      const logs = await cloud.adminGetLogs({ page: 1, limit: 5000 });
      const rows = Array.isArray(logs && logs.rows) ? logs.rows : [];
      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      const buckets = [];
      if (mode === 'weekly') {
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          buckets.push({
            label: `${dd}/${mm}`,
            start: d.getTime(),
            end: d.getTime() + 86400000
          });
        }
      } else {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        start.setMonth(start.getMonth() - 11);
        for (let i = 0; i < 12; i++) {
          const m = new Date(start.getFullYear(), start.getMonth() + i, 1);
          const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
          const mm = String(m.getMonth() + 1).padStart(2, '0');
          buckets.push({
            label: `${mm}/${m.getFullYear()}`,
            start: m.getTime(),
            end: next.getTime()
          });
        }
      }

      const success = Array.from({ length: buckets.length }, () => 0);
      const fail = Array.from({ length: buckets.length }, () => 0);

      for (const r of rows) {
        const ts = Number(r && r.ts);
        if (!Number.isFinite(ts)) continue;
        let idx = -1;
        for (let i = 0; i < buckets.length; i++) {
          if (ts >= buckets[i].start && ts < buckets[i].end) {
            idx = i;
            break;
          }
        }
        if (idx < 0) continue;
        const action = String(r && r.action || '').toLowerCase();
        const isFail = action.includes('échec') || action.includes('echec') || action.includes('fail');
        if (isFail) fail[idx] += 1;
        else success[idx] += 1;
      }

      return {
        success: true,
        period: mode,
        labels: buckets.map((b) => b.label),
        success,
        fail
      };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:getLogs', async (_event, filters = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const merged = await buildMergedLogs(filters || {});
      return { success: true, ...merged };
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

    try {
      const merged = await buildMergedLogs({ ...(filters || {}), page: 1, limit: 5000 });
      const escapeCsv = (v) => {
        const s = String(v == null ? '' : v);
        if (/[",\n\r;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };

      const header = ['ID', 'Société', 'Action', 'Date', 'Heure'].join(';') + '\n';
      fs.writeFileSync(pick.filePath, header, 'utf8');

      let chunk = '';
      for (const row of merged.rows || []) {
        const ts = Number(row.ts || 0);
        const dt = Number.isFinite(ts) ? new Date(ts) : new Date();
        const date = dt.toLocaleDateString('fr-FR');
        const time = dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        chunk += [
          escapeCsv(`#${row.id}`),
          escapeCsv(row.company_name || '—'),
          escapeCsv(row.action || '—'),
          escapeCsv(date),
          escapeCsv(time)
        ].join(';') + '\n';
      }
      fs.appendFileSync(pick.filePath, chunk, 'utf8');
      return { success: true, filePath: pick.filePath, total: Number(merged.total || 0) };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:getAdminLogs', async () => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    return { success: true, logs: adminLogs.slice(-200) };
  });

  ipcMain.handle('admin:listAllSites', async () => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const sites = await cloud.adminListAllSites();
      return { success: true, sites };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:listSites', async (_event, _token, payload = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const sites = await cloud.adminListSites({ clientId: payload.clientId, username: payload.username });
      return { success: true, sites };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:createSite', async (_event, _token, payload = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      const sites = await cloud.adminCreateSite({ clientId: payload.clientId, username: payload.username, name: payload.name });
      return { success: true, sites };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:renameSite', async (_event, _token, payload = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      await cloud.adminRenameSite({ siteId: payload.siteId, name: payload.name });
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:deleteSite', async (_event, _token, payload = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      await cloud.adminDeleteSite({ siteId: payload.siteId });
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:createMasterDump', async (_event, _token, payload = {}) => {
    if (!(authSessionUser && authSessionUser.role === 'admin')) {
      return { success: false, error: 'admin_required' };
    }
    try {
      if (String(payload.mode || 'direct') === 'manual') {
        const dumpHex = String(payload.dumpHex || '');
        await cloud.adminUpsertMasterDump({
          clientId: payload.clientId,
          username: payload.username,
          dumpHex,
          uid: payload.uid || null,
          source: 'manual',
          siteId: payload.siteId == null ? null : Number(payload.siteId)
        });
      } else {
        const d = await cloud.getLatestMasterDump();
        await cloud.adminUpsertMasterDump({
          clientId: payload.clientId,
          username: payload.username,
          dumpHex: String(d.dumpHex || ''),
          uid: d.uid || null,
          source: 'direct',
          siteId: payload.siteId == null ? null : Number(payload.siteId)
        });
      }
      emitAdminLog(`DUMP actif mis à jour clientId=${payload.clientId || 'n/a'}`);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('admin:syncCopyEvents', async (_event, events = []) => {
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

  ipcMain.handle('admin:backupDb', async () => ({ success: true }));
  ipcMain.handle('admin:getDbPath', async () => ({ success: true, path: '' }));
  ipcMain.handle('admin:testCopy', async () => ({ success: true }));
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
      return { success: true, client: r && r.client ? r.client : null, tempPassword: r && r.tempPassword ? r.tempPassword : null };
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

  ipcMain.handle('dashboard:getStats', async () => ({ success: true, stats: { totalCopies: 0, successRate: 0 } }));
  ipcMain.handle('dashboard:getRecentCopies', async () => ({ success: true, rows: [] }));
  ipcMain.handle('matrix:sync', async () => ({ success: true }));
  ipcMain.handle('matrix:readLog', async () => ({ success: true, rows: [] }));
  ipcMain.handle('sites:getAll', async () => ({ success: true, sites: [] }));
  ipcMain.handle('sites:create', async () => ({ success: true }));
}

module.exports = { registerHandlers };
