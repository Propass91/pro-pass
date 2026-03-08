function createNoopUnsub() {
  return () => {};
}

function getDefaultApiBase() {
  const fromStorage = String(localStorage.getItem('ppc_cloud_base') || '').trim();
  if (fromStorage) return fromStorage.replace(/\/+$/, '');

  if (typeof window !== 'undefined' && window.location && /^https?:$/i.test(window.location.protocol)) {
    const host = String(window.location.hostname || '').toLowerCase();
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return window.location.origin.replace(/\/+$/, '');
    }
  }

  return 'https://www.pro-pass.app';
}

function createEmitter() {
  const map = new Map();
  return {
    on(eventName, cb) {
      if (!map.has(eventName)) map.set(eventName, new Set());
      map.get(eventName).add(cb);
      return () => {
        try { map.get(eventName).delete(cb); } catch (_) {}
      };
    },
    emit(eventName, payload) {
      const listeners = map.get(eventName);
      if (!listeners) return;
      listeners.forEach((cb) => {
        try { cb(payload); } catch (_) {}
      });
    }
  };
}

function buildQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v == null || v === '') return;
    qs.set(k, String(v));
  });
  const out = qs.toString();
  return out ? `?${out}` : '';
}

function saveSession(token, user) {
  try {
    if (!token || !user) {
      localStorage.removeItem('ppc_session_v1');
      return;
    }
    localStorage.setItem('ppc_session_v1', JSON.stringify({ token, user }));
  } catch (_) {}
}

function readSession() {
  try {
    const raw = localStorage.getItem('ppc_session_v1');
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !parsed.token || !parsed.user) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function normalizeUserFromLoginPayload(payload) {
  const role = String(payload && payload.role || 'client');
  if (role === 'admin') {
    const u = payload && payload.user ? payload.user : {};
    return {
      id: u.id,
      username: u.username,
      role: 'admin'
    };
  }

  const c = payload && payload.client ? payload.client : {};
  return {
    id: c.id,
    username: c.username,
    name: c.name,
    email: c.email,
    role: 'client'
  };
}

function installWebApiBridge() {
  if (typeof window === 'undefined') return;
  if (window.api) return;

  const emitter = createEmitter();
  let authToken = null;
  let currentUser = null;

  const saved = readSession();
  if (saved) {
    authToken = String(saved.token || '');
    currentUser = saved.user || null;
  }

  const requestJson = async (path, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    const includeAuth = options.includeAuth !== false;

    if (includeAuth && authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    let body = options.body;
    if (body != null && typeof body !== 'string' && !(body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = JSON.stringify(body);
    }

    const base = getDefaultApiBase();
    const url = `${base}${path}`;
    const res = await fetch(url, { method, headers, body });
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }

    if (!res.ok) {
      const err = new Error(String((data && data.error) || `HTTP_${res.status}`));
      err.status = res.status;
      err.payload = data;
      throw err;
    }

    if (!data && /^\s*</.test(String(raw || ''))) {
      throw new Error(`HTML_RESPONSE_${path}`);
    }

    return data || { ok: true };
  };

  const auth = {
    async login(username, password) {
      try {
        const payload = await requestJson('/auth/login', {
          method: 'POST',
          includeAuth: false,
          body: { username, password }
        });
        if (!payload || !payload.ok || !payload.token) {
          return { success: false, error: 'invalid_credentials' };
        }
        authToken = String(payload.token);
        currentUser = normalizeUserFromLoginPayload(payload);
        saveSession(authToken, currentUser);
        return { success: true, token: authToken, user: currentUser };
      } catch (e) {
        return { success: false, error: String(e && e.message || 'invalid_credentials') };
      }
    },
    async getCurrentUser() {
      return currentUser || null;
    },
    async restoreSession(payload) {
      const token = String(payload && payload.token || authToken || '');
      const user = (payload && payload.user) || currentUser;
      if (!token || !user) return { success: false, error: 'missing_session' };

      const prevToken = authToken;
      const prevUser = currentUser;
      authToken = token;
      currentUser = user;

      try {
        if (String(user.role || '') === 'admin') {
          await requestJson('/admin/stats', { method: 'GET' });
        } else {
          await requestJson('/client/quota', { method: 'GET' });
        }
        saveSession(authToken, currentUser);
        return { success: true, user: currentUser };
      } catch (_) {
        authToken = prevToken;
        currentUser = prevUser;
        saveSession(authToken, currentUser);
        return { success: false, error: 'session_invalid' };
      }
    },
    async logout() {
      authToken = null;
      currentUser = null;
      saveSession(null, null);
      return { success: true };
    },
    async requestReset(input) {
      const username = String((input && input.username) || input || '').trim();
      if (!username) return { success: false, error: 'missing_username' };
      try {
        const r = await requestJson('/auth/request-reset', {
          method: 'POST',
          includeAuth: false,
          body: { username }
        });
        return { success: !!(r && r.ok) };
      } catch (e) {
        return { success: false, error: String(e && e.message || 'request_reset_failed') };
      }
    },
    async confirmReset(token, newPassword) {
      try {
        const r = await requestJson('/auth/confirm-reset', {
          method: 'POST',
          includeAuth: false,
          body: { token, new_password: newPassword }
        });
        return { success: !!(r && r.ok) };
      } catch (e) {
        return { success: false, error: String(e && e.message || 'confirm_reset_failed') };
      }
    }
  };

  const cloud = {
    async isOnline() {
      try {
        const r = await requestJson('/health', { method: 'GET', includeAuth: false });
        return { ok: true, online: !!(r && r.ok) };
      } catch (_) {
        return { ok: true, online: false };
      }
    },
    onQuotaUpdate(cb) {
      return emitter.on('quota:update', cb);
    }
  };

  const nfc = {
    async isConnected() { return { connected: false }; },
    async init() { return { success: false, connected: false, error: 'NO_READER' }; },
    async readDump() { return { success: false, error: 'NO_READER' }; },
    async startPresenceWatch() { return { success: false, connected: false, error: 'NO_READER' }; },
    async stopPresenceWatch() { return { success: true }; },
    async writeDump() { return { success: false, error: 'NO_READER', message: 'Lecteur NFC non disponible en mode web' }; },
    async writeDumpMagic() { return { success: false, error: 'NO_READER' }; },
    onPyLog() { return createNoopUnsub(); },
    onCardPresent() { return createNoopUnsub(); },
    onCardRemoved() { return createNoopUnsub(); }
  };

  const dumps = {
    async getQuota() {
      const r = await requestJson('/client/quota', { method: 'GET' });
      if (!r || !r.ok || !r.quota) return { remaining: 0, monthly_limit: 15 };
      return r.quota;
    },
    async getActiveDump() {
      try {
        const r = await requestJson('/client/dumps/active', { method: 'GET' });
        if (!r || !r.ok || !r.dump || !r.dump.dump_hex) {
          return { success: false, error: 'no_active_dump' };
        }
        return {
          success: true,
          data: String(r.dump.dump_hex),
          source: 'cloud',
          lastSyncTs: Number(Date.parse(String(r.dump.created_at || ''))) || Date.now()
        };
      } catch (e) {
        return { success: false, error: String(e && e.message || 'no_active_dump') };
      }
    },
    onDumpUpdated() {
      return createNoopUnsub();
    },
    async writeAdminDump() {
      const r = await requestJson('/client/quota/decrement', { method: 'POST', body: {} });
      const quota = (r && r.quota) || null;
      if (quota) {
        emitter.emit('quota:update', {
          remaining: Number(quota.remaining || 0),
          monthly_limit: Number(quota.monthly_limit || 15),
          valid_until: quota.valid_until || null
        });
      }
      return { success: !!(r && r.ok), quota };
    },
    async logCopyFail() {
      const r = await requestJson('/client/copy-log/fail', { method: 'POST', body: {} });
      return { success: !!(r && r.ok) };
    }
  };

  const admin = {
    async login() { return { success: false, error: 'not_supported_in_web' }; },
    async getSessionToken() {
      if (currentUser && currentUser.role === 'admin' && authToken) {
        return { success: true, token: authToken };
      }
      return { success: false, error: 'admin_required' };
    },
    async getDbPath() { return { success: true, path: '' }; },
    async backupDb() { return { success: true }; },
    async listClients() {
      const r = await requestJson('/admin/clients', { method: 'GET' });
      return { success: !!(r && r.ok), clients: Array.isArray(r && r.clients) ? r.clients : [] };
    },
    async listSites(_token, payload = {}) {
      const q = buildQuery({ clientId: payload.clientId, username: payload.username });
      const r = await requestJson(`/admin/sites${q}`, { method: 'GET' });
      return { success: !!(r && r.ok), sites: Array.isArray(r && r.sites) ? r.sites : [] };
    },
    async createSite(_token, payload = {}) {
      const r = await requestJson('/admin/sites', {
        method: 'POST',
        body: {
          clientId: payload.clientId,
          username: payload.username,
          name: payload.name
        }
      });
      return { success: !!(r && r.ok), sites: Array.isArray(r && r.sites) ? r.sites : [] };
    },
    async renameSite(_token, payload = {}) {
      const r = await requestJson(`/admin/sites/${Number(payload.siteId)}`, {
        method: 'PATCH',
        body: { name: payload.name }
      });
      return { success: !!(r && r.ok) };
    },
    async deleteSite(_token, payload = {}) {
      const r = await requestJson(`/admin/sites/${Number(payload.siteId)}`, {
        method: 'DELETE'
      });
      return { success: !!(r && r.ok) };
    },
    async listAllSites() {
      const r = await requestJson('/admin/sites/all', { method: 'GET' });
      return { success: !!(r && r.ok), sites: Array.isArray(r && r.sites) ? r.sites : [] };
    },
    async addQuota(_token, payload = {}) {
      const r = await requestJson('/admin/client/add-quota', {
        method: 'POST',
        body: {
          clientId: payload.clientId,
          username: payload.username,
          addQuota: Number(payload.addQuota || 0),
          validity_days: 30
        }
      });
      return { success: !!(r && r.ok), client: r && r.client ? r.client : null };
    },
    async createMasterDump(_token, payload = {}) {
      if (String(payload.mode || 'direct') === 'direct') {
        return { success: false, error: 'nfc_reader_required_on_desktop' };
      }
      const r = await requestJson('/admin/master-dump', {
        method: 'POST',
        body: {
          clientId: payload.clientId,
          username: payload.username,
          dump_hex: payload.dumpHex,
          uid: payload.uid || null,
          source: 'manual',
          siteId: payload.siteId == null ? null : Number(payload.siteId)
        }
      });
      return { success: !!(r && r.ok), client: r && r.client ? r.client : null };
    },
    async testCopy() {
      return { success: true };
    },
    async getStats() {
      const r = await requestJson('/admin/stats', { method: 'GET' });
      return { success: !!(r && r.ok), stats: r && r.stats ? r.stats : { totalClients: 0, totalCopies: 0 } };
    },
    async getCopyStats(period) {
      const q = buildQuery({ period: period === 'weekly' ? 'weekly' : 'monthly' });
      const r = await requestJson(`/admin/copy-stats${q}`, { method: 'GET' });
      return {
        period: String(r && r.period || period || 'monthly'),
        labels: Array.isArray(r && r.labels) ? r.labels : [],
        success: Array.isArray(r && r.success) ? r.success : [],
        fail: Array.isArray(r && r.fail) ? r.fail : []
      };
    },
    async syncCopyEvents(events) {
      const r = await requestJson('/admin/copy-events/bulk', {
        method: 'POST',
        body: { events: Array.isArray(events) ? events : [] }
      });
      return { success: !!(r && r.ok), inserted: Number(r && r.inserted || 0) };
    },
    async getClients() {
      return admin.listClients();
    },
    async createClient(data = {}) {
      const r = await requestJson('/admin/clients', {
        method: 'POST',
        body: data
      });
      return { success: !!(r && r.ok), client: r && r.client ? r.client : null, tempPassword: r && r.tempPassword ? r.tempPassword : null };
    },
    async updateClient(id, data = {}) {
      const r = await requestJson(`/admin/clients/${Number(id)}`, {
        method: 'PATCH',
        body: data
      });
      return { success: !!(r && r.ok), client: r && r.client ? r.client : null };
    },
    async toggleClientStatus(id) {
      const r = await requestJson(`/admin/clients/${Number(id)}/toggle`, {
        method: 'POST',
        body: {}
      });
      return { success: !!(r && r.ok), client: r && r.client ? r.client : null };
    },
    async sendInvitationEmail(clientId) {
      const r = await requestJson(`/admin/clients/${Number(clientId)}/send-invite`, {
        method: 'POST',
        body: {}
      });
      return {
        success: !!(r && r.ok),
        sent: !!(r && r.sent),
        error: r && r.error ? r.error : null,
        resetUrl: r && r.resetUrl ? r.resetUrl : null,
        expiresAt: r && (r.expiresAt || r.expires_at) ? (r.expiresAt || r.expires_at) : null
      };
    },
    async getAdminLogs() {
      const r = await requestJson('/admin/logs?page=1&limit=30', { method: 'GET' });
      const rows = Array.isArray(r && r.rows) ? r.rows : [];
      const lines = rows.map((x) => {
        const d = new Date(Number(x && x.ts || 0));
        const hhmm = Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const company = String(x && x.company_name || '-');
        const action = String(x && x.action || '-');
        return `[${hhmm}] ${company} - ${action}`;
      });
      return { success: true, logs: lines };
    },
    async getLogs(filters = {}) {
      const q = buildQuery({
        societe: filters.societe,
        action: filters.action,
        dateDebut: filters.dateDebut,
        dateFin: filters.dateFin,
        page: filters.page,
        limit: filters.limit
      });
      const r = await requestJson(`/admin/logs${q}`, { method: 'GET' });
      return {
        success: !!(r && r.ok),
        rows: Array.isArray(r && r.rows) ? r.rows : [],
        total: Number(r && r.total || 0),
        pageCount: Number(r && r.pageCount || 1),
        page: Number(r && r.page || 1),
        limit: Number(r && r.limit || 10)
      };
    },
    async exportLogs(filters = {}) {
      const r = await admin.getLogs({ ...filters, page: 1, limit: 5000 });
      if (!r || !r.success) return { success: false, error: 'export_failed' };

      const esc = (v) => {
        const s = String(v == null ? '' : v);
        if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      let csv = 'ID;Société;Action;Date;Heure\n';
      (r.rows || []).forEach((row) => {
        const ts = Number(row && row.ts || 0);
        const d = new Date(ts);
        const date = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
        const time = Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        csv += [
          esc(`#${row && row.id}`),
          esc(row && row.company_name),
          esc(row && row.action),
          esc(date),
          esc(time)
        ].join(';') + '\n';
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `logs_propass_${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true, total: Number(r.total || 0) };
    },
    onLog() {
      return createNoopUnsub();
    }
  };

  const api = {
    async getStats() {
      if (!currentUser || currentUser.role !== 'client') {
        return { ok: true, stats: { copiesThisMonth: 0, quotaRemaining: 0, quotaTotal: 0 }, recent: [] };
      }
      const q = await dumps.getQuota();
      const total = Number(q && q.monthly_limit || 0);
      const remaining = Number(q && q.remaining || 0);
      return {
        ok: true,
        stats: {
          copiesThisMonth: Math.max(0, total - remaining),
          quotaRemaining: remaining,
          quotaTotal: total
        },
        recent: []
      };
    },
    auth,
    cloud,
    nfc,
    dumps,
    dump: {
      async saveActive(adminToken, payload = {}) {
        const previous = authToken;
        if (adminToken) authToken = String(adminToken);
        try {
          const r = await requestJson('/admin/dumps/active', {
            method: 'POST',
            body: {
              dump_hex: payload.dumpHex || payload.dump_hex,
              uid: payload.uid || null,
              source: payload.source || 'manual'
            }
          });
          return { success: !!(r && r.ok), dump: r && r.dump ? r.dump : null };
        } finally {
          authToken = previous;
        }
      }
    },
    sites: {
      async getAll() {
        return admin.listAllSites();
      },
      async create(payload = {}) {
        return admin.createSite(null, payload);
      }
    },
    admin,
    stats: {
      async getDashboard() {
        return api.getStats();
      }
    }
  };

  window.api = api;
}

installWebApiBridge();
