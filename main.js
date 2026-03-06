const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

// Load root .env for local dev (no hard-coded secrets)
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '.env') });
} catch (_) {}

// Debug helper: log failing fetch URLs (main process)
try {
  if (typeof globalThis.fetch === 'function' && !globalThis.__ppcFetchWrapped) {
    globalThis.__ppcFetchWrapped = true;
    const _fetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (...args) => {
      const url = (() => {
        try { return String(args && args[0] || ''); } catch (_) { return ''; }
      })();
      try {
        return await _fetch(...args);
      } catch (e) {
        try {
          console.error('FETCH_MAIN_FAIL url=' + url, e && (e.stack || e.message) || e);
          appendDebug('FETCH_MAIN_FAIL url=' + url + ' ' + (e && (e.stack || e.message) || e));
        } catch (_) {}
        throw e;
      }
    };
  }
} catch (_) {}

const { CloudClient } = require('./electron/cloud/cloudClient');

const DEBUG_LOG_PATH = path.join(os.tmpdir(), 'propass_debug.log');
function appendDebug(line) {
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, `[${new Date().toISOString()}] ${String(line || '')}\n`, 'utf8');
  } catch (_) {}
}

function _stringifyErr(x) {
  try {
    if (!x) return '';
    if (typeof x === 'string') return x;
    return String(x.stack || x.message || x);
  } catch (_) {
    return String(x);
  }
}

process.on('unhandledRejection', (reason) => {
  try {
    const msg = _stringifyErr(reason);
    console.error('UNHANDLED_REJECTION', msg);
    appendDebug('UNHANDLED_REJECTION ' + msg);
    try {
      if (!app.isPackaged) {
        dialog.showErrorBox('Erreur (debug)', `UNHANDLED_REJECTION\n\n${msg}`);
      }
    } catch (_) {}
  } catch (_) {}
});

process.on('uncaughtException', (err) => {
  try {
    const msg = _stringifyErr(err);
    console.error('UNCAUGHT_EXCEPTION', msg);
    appendDebug('UNCAUGHT_EXCEPTION ' + msg);
    try {
      if (!app.isPackaged) {
        dialog.showErrorBox('Erreur (debug)', `UNCAUGHT_EXCEPTION\n\n${msg}`);
      }
    } catch (_) {}
  } catch (_) {}
});

let globalMainWindow = null;

let _connectivityFails = 0;
let _connectivityTimer = null;

let _localCloudProc = null;
let _localCloudInProcStarted = false;

function registerIpcHandlersOrThrow(ipcMainRef) {
  const errors = [];
  const candidates = [
    {
      label: './ipc/handlers',
      load: () => {
        const mod = require('./ipc/handlers');
        if (!mod || typeof mod.registerHandlers !== 'function') {
          throw new Error('registerHandlers missing');
        }
        mod.registerHandlers(ipcMainRef);
      }
    },
    {
      label: './electron/ipc/handlers',
      load: () => {
        const mod = require('./electron/ipc/handlers');
        if (!mod || typeof mod.registerHandlers !== 'function') {
          throw new Error('registerHandlers missing');
        }
        mod.registerHandlers(ipcMainRef);
      }
    },
    {
      label: './handlers',
      load: () => {
        const mod = require('./handlers');
        if (typeof mod !== 'function') {
          throw new Error('export is not a function');
        }
        mod(ipcMainRef);
      }
    }
  ];

  for (const c of candidates) {
    try {
      c.load();
      const okMsg = `[IPC] Handlers registered from ${c.label}`;
      console.log(okMsg);
      appendDebug(okMsg);
      return;
    } catch (e) {
      const failMsg = `[IPC] Failed to load ${c.label}: ${_stringifyErr(e)}`;
      console.warn(failMsg);
      appendDebug(failMsg);
      errors.push(failMsg);
    }
  }

  throw new Error(`No IPC handlers could be loaded :: ${errors.join(' | ')}`);
}

function _isLocalCandidate(baseUrl) {
  try {
    const u = new URL(String(baseUrl));
    const host = String(u.hostname || '').toLowerCase();
    return host === '127.0.0.1' || host === 'localhost';
  } catch (_) {
    const s = String(baseUrl || '').toLowerCase();
    return s.includes('127.0.0.1') || s.includes('localhost');
  }
}

async function _waitForHealth(url, timeoutMs = 4500) {
  const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1000);
      try {
        const res = await fetch(String(url).replace(/\/+$/, '') + '/health', { signal: controller.signal });
        if (res && res.ok) {
          const j = await res.json().catch(() => null);
          if (j && j.ok) return true;
        }
      } finally {
        clearTimeout(t);
      }
    } catch (_) {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function ensureLocalCloudRunning() {
  const baseUrl = 'http://127.0.0.1:8787';
  // Already healthy
  if (await _waitForHealth(baseUrl, 1200)) return true;

  // Already started by this app
  if (_localCloudProc && !_localCloudProc.killed) {
    return await _waitForHealth(baseUrl, 3500);
  }

  // Prefer spawning a separate Node-like process. In some packaged setups, executing a script
  // inside app.asar can be flaky; we'll fall back to an in-process start below.
  const dbPath = path.join(app.getPath('userData'), 'database.db');

  try {
    const serverPath = path.join(__dirname, 'cloud', 'server.js');
    const childEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: '8787',
      PROPASS_SQLITE_PATH: dbPath,
      PROPASS_SKIP_DOTENV: '1'
    };
    appendDebug('LOCAL_CLOUD_SPAWN ' + serverPath);

    // Using ELECTRON_RUN_AS_NODE is more reliable than --runAsNode in some packaged setups.
    _localCloudProc = spawn(process.execPath, [serverPath], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    try {
      appendDebug('LOCAL_CLOUD_PROC_PID ' + String(_localCloudProc && _localCloudProc.pid));
    } catch (_) {}

    try {
      if (_localCloudProc && _localCloudProc.stdout) {
        _localCloudProc.stdout.on('data', (buf) => {
          try { appendDebug('LOCAL_CLOUD_STDOUT ' + String(buf || '').slice(0, 2000)); } catch (_) {}
        });
      }
      if (_localCloudProc && _localCloudProc.stderr) {
        _localCloudProc.stderr.on('data', (buf) => {
          try { appendDebug('LOCAL_CLOUD_STDERR ' + String(buf || '').slice(0, 2000)); } catch (_) {}
        });
      }
    } catch (_) {}

    _localCloudProc.on('error', (e) => {
      appendDebug('LOCAL_CLOUD_PROC_ERROR ' + _stringifyErr(e));
    });
    _localCloudProc.on('exit', (code, signal) => {
      appendDebug('LOCAL_CLOUD_PROC_EXIT code=' + String(code) + ' signal=' + String(signal || ''));
    });

    try { _localCloudProc.unref(); } catch (_) {}
  } catch (e) {
    appendDebug('LOCAL_CLOUD_SPAWN_FAIL ' + _stringifyErr(e));
  }

  // Wait a bit for the spawned server.
  if (await _waitForHealth(baseUrl, 3500)) {
    appendDebug('LOCAL_CLOUD_OK child');
    return true;
  }

  // Fallback: start the cloud server in-process (works with app.asar).
  if (!_localCloudInProcStarted) {
    try {
      appendDebug('LOCAL_CLOUD_INPROC_START');
      process.env.PORT = '8787';
      process.env.PROPASS_SQLITE_PATH = dbPath;
      process.env.PROPASS_SKIP_DOTENV = '1';
      require('./cloud/server.js');
      _localCloudInProcStarted = true;
      appendDebug('LOCAL_CLOUD_INPROC_LOADED');
    } catch (e) {
      appendDebug('LOCAL_CLOUD_INPROC_FAIL ' + _stringifyErr(e));
      _localCloudInProcStarted = false;
    }
  }

  const ok = await _waitForHealth(baseUrl, 6000);
  if (ok) appendDebug('LOCAL_CLOUD_OK inproc');
  return ok;
}

async function resolveCloudBaseUrl() {
  const candidates = [];
  const envUrl = String(process.env.PROPASS_CLOUD_URL || '').trim();
  if (envUrl) candidates.push(envUrl);

  // Production default (zero-config)
  candidates.push('https://www.pro-pass.app');

  // Local fallback (useful before the domain/DNS/proxy are set up)
  candidates.push('http://127.0.0.1:8787');
  candidates.push('http://localhost:8787');

  // Deduplicate while preserving order
  const seen = new Set();
  const uniq = [];
  for (const c of candidates) {
    const k = String(c || '').trim().replace(/\/+$/, '');
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(k);
  }

  for (const baseUrl of uniq) {
    try {
      const cloud = new CloudClient({ baseUrl });
      for (let i = 0; i < 4; i++) {
        const ok = await cloud.checkOnline();
        if (ok) return baseUrl;

        // If the candidate is local, auto-start the embedded cloud once.
        if (i === 0 && _isLocalCandidate(baseUrl)) {
          try {
            const started = await ensureLocalCloudRunning();
            if (started) {
              const ok2 = await cloud.checkOnline();
              if (ok2) return baseUrl;
            }
          } catch (_) {}
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    } catch (_) {
      // try next
    }
  }

  // Last resort: try to boot local cloud, then use it.
  try {
    const started = await ensureLocalCloudRunning();
    if (started) return 'http://127.0.0.1:8787';
  } catch (_) {}

  return null;
}

function createWindow() {
  const iconPath = (() => {
    try {
      if (process.platform === 'win32') {
        const p = path.join(__dirname, 'build', 'icon.ico');
        if (fs.existsSync(p)) return p;
      } else {
        const p = path.join(__dirname, 'build', 'icon.round.png');
        if (fs.existsSync(p)) return p;
      }
    } catch (_) {}
    return undefined;
  })();

  const win = new BrowserWindow({
    width: 900,
    height: 650,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.removeMenu();
  // Ensure window title matches branding
  try { win.setTitle('PROPASS'); } catch (e) {}
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  try {
    win.webContents.on('console-message', (_event, _level, message) => {
      try { console.log('RENDER_CONSOLE', String(message || '')); } catch (_) {}
    });
  } catch (_) {}
  try {
    if (String(process.env.PROPASS_DEVTOOLS || '').toLowerCase() === 'true') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } catch (_) {}
  try {
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        try {
          win.webContents.executeJavaScript("(()=>{const r=document.getElementById('root');return {hasRoot:!!r, childCount:r? r.childElementCount:0, textLen:r? (r.innerText||'').length:0};})()")
            .then((info) => console.log('UI_RENDER_CHECK', info))
            .catch((e) => console.warn('UI_RENDER_CHECK_FAILED', e && e.message));
        } catch (e) {
          console.warn('UI_RENDER_CHECK_SETUP_FAILED', e && e.message);
        }
      }, 750);
    });
  } catch (_) {}
  globalMainWindow = win;
}

// Register handlers and create window when ready
app.whenReady().then(async () => {
  // Mandatory Cloud connectivity (with automatic fallback between prod + local)
  let chosenBaseUrl = null;
  try {
    chosenBaseUrl = await resolveCloudBaseUrl();
  } catch (_) {
    chosenBaseUrl = null;
  }

  if (!chosenBaseUrl) {
    try {
      dialog.showErrorBox(
        'Connexion requise',
        'Impossible de se connecter au serveur PROPASS.\n\n' +
        'Vérifiez votre connexion Internet, ou démarrez le serveur cloud local (http://127.0.0.1:8787).\n\n' +
        'Vous pouvez aussi définir PROPASS_CLOUD_URL pour forcer l’URL du serveur.'
      );
    } catch (_) {}
    app.quit();
    return;
  }

  // Make the selected URL available for all modules (handlers instantiate CloudClient at import time)
  process.env.PROPASS_CLOUD_URL = String(chosenBaseUrl);

  try {
    registerIpcHandlersOrThrow(ipcMain);
  } catch (e) {
    const msg = _stringifyErr(e);
    console.error('handlers failed to register', msg);
    appendDebug('HANDLERS_REGISTER_FAIL ' + msg);
    try {
      dialog.showErrorBox(
        'Erreur d\'initialisation',
        'Les handlers IPC n\'ont pas pu être enregistrés.\n\n' + msg
      );
    } catch (_) {}
    app.quit();
    return;
  }

  createWindow();

  // Enforce mandatory Internet connectivity throughout the session.
  try {
    const cloud = new CloudClient({ baseUrl: process.env.PROPASS_CLOUD_URL });
    if (_connectivityTimer) {
      try { clearInterval(_connectivityTimer); } catch (_) {}
      _connectivityTimer = null;
    }
    _connectivityTimer = setInterval(async () => {
      try {
        const online = await cloud.checkOnline();
        if (online) {
          _connectivityFails = 0;
          return;
        }
      } catch (_) {
        // treat as offline
      }

      _connectivityFails += 1;
      if (_connectivityFails < 3) return; // avoid transient blips

      try {
        dialog.showErrorBox(
          'Connexion perdue',
          'Connexion Internet requise pour utiliser PROPASS.\n\nLa connexion au serveur est perdue. L\'application va se fermer.'
        );
      } catch (_) {}
      try { app.quit(); } catch (_) {}
    }, 8000);
  } catch (_) {
    // ignore
  }
  // Optional legacy auto-init for diagnostics only. Disabled by default to
  // avoid reader contention with the IPC-managed NFC service.
  if (String(process.env.PROPASS_NFC_AUTO_INIT || '').toLowerCase() === 'true') {
    try {
      const { NFCService } = require('./electron/nfc/nfcService');
      (async () => {
        try {
          const _autoNfc = new NFCService();
          await _autoNfc.init();
          console.log('✅ NFC AUTO INIT OK', _autoNfc.getReaderName());
          _autoNfc.onCardPresent((uid) => {
            try {
              if (globalMainWindow && globalMainWindow.webContents) globalMainWindow.webContents.send('nfc:cardPresent', uid);
            } catch (_) {}
          });
          _autoNfc.onCardRemoved(() => {
            try {
              if (globalMainWindow && globalMainWindow.webContents) globalMainWindow.webContents.send('nfc:cardRemoved');
            } catch (_) {}
          });
        } catch (err) {
          console.error('❌ NFC AUTO INIT FAILED:', err && err.message);
        }
      })();
    } catch (_) {
      // ignore if module cannot be required during startup
    }
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('before-quit', () => {
  try {
    if (_localCloudProc && !_localCloudProc.killed) {
      _localCloudProc.kill();
    }
  } catch (_) {}
});

// --- Helper: run python task (kept from previous implementation) ---
// Persist user data and database outside of the ASAR using app.getPath('userData')
const USER_DATA_PATH = app.getPath('userData');
try { if (!fs.existsSync(USER_DATA_PATH)) fs.mkdirSync(USER_DATA_PATH, { recursive: true }); } catch (e) { /* ignore */ }
const USERS_PATH = path.join(USER_DATA_PATH, 'users.json');
const HISTORY_PATH = path.join(USER_DATA_PATH, 'results.json');
const DB_PATH = path.join(USER_DATA_PATH, 'propass.db');

ipcMain.handle('ppc:run-task', async (event, taskName, args = []) => {
  return new Promise((resolve) => {
    const script = taskName === 'extraction-genesis'
      ? 'extraction_genesis.py'
      : taskName === 'restauration-alpha'
        ? 'restauration_alpha.py'
        : taskName === 'extraction-gen2'
          ? 'extraction_gen2.py'
          : taskName === 'restauration-gen2'
            ? 'restauration_gen2.py'
            : `${taskName}.py`;
    const pyPath = path.join(__dirname, 'python_engines', script);
    const py = spawn('python', [pyPath, ...args]);
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => { out += d.toString(); event.sender.send('ppc:log', d.toString()); });
    py.stderr.on('data', (d) => { err += d.toString(); event.sender.send('ppc:error', d.toString()); });
    py.on('close', (code) => resolve({ code, out, err }));
  });
});

// temp result polling
const TEMP_RESULT = path.join(os.tmpdir(), 'propass_write_result.txt');
let _lastTempMtime = 0;
function parseResultFile(content) {
  const out = {};
  content.split(/\r?\n/).forEach(line => {
    if (!line) return;
    const idx = line.indexOf('=');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx+1).trim();
      out[k] = v;
    }
  });
  if (out.OUT && fs.existsSync(out.OUT)) {
    try { out.LOG = fs.readFileSync(out.OUT, 'utf8'); } catch (e) { out.LOG = ''; }
  }
  return out;
}
function appendHistory(record) {
  try {
    let arr = [];
    if (fs.existsSync(HISTORY_PATH)) {
      try { arr = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')) || []; } catch (e) { arr = []; }
    }
    arr.push(record);
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) { console.warn('Unable to append history', e); }
}
function checkTempResultFile() {
  try {
    if (!fs.existsSync(TEMP_RESULT)) return;
    const st = fs.statSync(TEMP_RESULT);
    if (st.mtimeMs <= _lastTempMtime) return;
    _lastTempMtime = st.mtimeMs;
    const content = fs.readFileSync(TEMP_RESULT, 'utf8');
    const parsed = parseResultFile(content);
    parsed._ts = new Date().toISOString();
    appendHistory(parsed);
    try { const w = globalMainWindow; if (w && w.webContents) w.webContents.send('ppc:write-result', parsed); } catch (e) {}
  } catch (e) { /* ignore */ }
}
setInterval(checkTempResultFile, 1500);

// minimal users functions kept (read/write)
function readUsers() {
  try { const raw = fs.readFileSync(USERS_PATH, 'utf8'); return JSON.parse(raw); } catch (e) { return { users: [] }; }
}
function writeUsers(obj) { try { fs.writeFileSync(USERS_PATH, JSON.stringify(obj, null, 2), 'utf8'); return true; } catch (e) { return false; } }

// Basic hw detection fallback (kept)
try {
  const { NFC } = require('nfc-pcsc');
  const nfc = new NFC();
  nfc.on('reader', reader => {
    console.log('ACR reader detected:', reader.name);
    try { if (globalMainWindow && globalMainWindow.webContents) globalMainWindow.webContents.send('ppc:hw-status', { available: true, reader: reader.name }); } catch(e){}
    reader.on('end', () => { try { if (globalMainWindow && globalMainWindow.webContents) globalMainWindow.webContents.send('ppc:hw-status', { available: false, reader: reader.name }); } catch(e){} });
  });
  nfc.on('error', err => { console.warn('nfc error', err); try { if (globalMainWindow && globalMainWindow.webContents) globalMainWindow.webContents.send('ppc:hw-status', { available: false, error: String(err) }); } catch(e){} });
} catch (e) {
  // ignore, python checker may be used elsewhere
}
