const { EventEmitter } = require('events');
const WebSocket = require('ws');

function normalizeBaseUrl(url) {
  const u = String(url || '').trim();
  return u.replace(/\/+$/, '');
}

function toWsUrl(httpBase) {
  const b = normalizeBaseUrl(httpBase);
  if (b.startsWith('https://')) return 'wss://' + b.slice('https://'.length);
  if (b.startsWith('http://')) return 'ws://' + b.slice('http://'.length);
  // fallback
  return 'ws://' + b;
}

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...headers
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal
    });

    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }

    if (!res.ok) {
      const err = new Error((json && json.error) ? String(json.error) : `HTTP_${res.status}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }

    return json;
  } finally {
    clearTimeout(t);
  }
}

class CloudClient extends EventEmitter {
  constructor({ baseUrl } = {}) {
    super();
    // Default to production cloud URL so client installs work without any manual env var setup.
    // Developers can still override via ctor baseUrl or PROPASS_CLOUD_URL.
    this.baseUrl = normalizeBaseUrl(baseUrl || process.env.PROPASS_CLOUD_URL || 'https://www.pro-pass.app');
    this.token = null;
    this.username = null;
    this.role = null; // 'client' | 'admin'
    this.cachedQuota = null;

    this.ws = null;
    this.wsAuthed = false;
    this._wsConnecting = false;

    this._wsReconnectTimer = null;
    this._wsReconnectAttempt = 0;
  }

  setBaseUrl(url) {
    this.baseUrl = normalizeBaseUrl(url);
  }

  async checkOnline() {
    try {
      const r = await fetchJson(`${this.baseUrl}/health`, { timeoutMs: 3500 });
      return !!(r && r.ok);
    } catch (_) {
      return false;
    }
  }

  async login(username, password) {
    const r = await fetchJson(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      body: { username, password },
      timeoutMs: 6500
    });

    if (!r || !r.ok || !r.token) {
      const err = new Error('invalid_credentials');
      err.code = 'invalid_credentials';
      throw err;
    }

    this.token = String(r.token);
    this.role = String(r.role || ((r.client && 'client') || (r.user && 'admin') || 'client'));
    this.username = String((r.client && r.client.username) || (r.user && r.user.username) || username);

    // WS is only useful for live quota on client accounts.
    if (this.role === 'client') {
      await this.connectWs();
      // Prime quota cache
      try { await this.getQuota(); } catch (_) {}
    }

    return r;
  }

  logout() {
    this.token = null;
    this.username = null;
    this.role = null;
    this.cachedQuota = null;
    this._closeWs();
  }

  _closeWs() {
    this.wsAuthed = false;
    this._wsConnecting = false;
    this._wsReconnectAttempt = 0;
    if (this._wsReconnectTimer) {
      try { clearTimeout(this._wsReconnectTimer); } catch (_) {}
      this._wsReconnectTimer = null;
    }
    try { if (this.ws) this.ws.close(); } catch (_) {}
    this.ws = null;
  }

  _scheduleWsReconnect() {
    if (!this.token) return;
    if (this.role !== 'client') return;
    if (this._wsReconnectTimer) return;
    const attempt = Math.min(6, Number(this._wsReconnectAttempt || 0) + 1);
    this._wsReconnectAttempt = attempt;
    const delayMs = Math.min(15000, 750 * Math.pow(2, attempt));
    this._wsReconnectTimer = setTimeout(async () => {
      this._wsReconnectTimer = null;
      try { await this.connectWs(); } catch (_) {}
    }, delayMs);
  }

  async connectWs() {
    if (!this.token) return;
    if (this.role && this.role !== 'client') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this._wsConnecting) return;

    this._wsConnecting = true;
    const wsUrl = toWsUrl(this.baseUrl);

    await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      this.wsAuthed = false;

      const finish = () => {
        this._wsConnecting = false;
        resolve();
      };

      ws.on('open', () => {
        try {
          ws.send(JSON.stringify({ type: 'auth', token: this.token }));
        } catch (_) {}
      });

      ws.on('message', (buf) => {
        try {
          const msg = JSON.parse(String(buf || ''));
          if (msg && msg.type === 'auth:ok') {
            this.wsAuthed = true;
            this.emit('ws:connected');
            finish();
            return;
          }
          if (msg && msg.type === 'quota:update' && msg.quota) {
            const q = {
              remaining: Number(msg.quota.remaining || 0),
              monthly_limit: Number(msg.quota.monthly_limit || 15),
              valid_until: msg.quota.valid_until || null
            };
            this.cachedQuota = q;
            this.emit('quota:update', q);
            return;
          }
        } catch (_) {
          // ignore
        }
      });

      ws.on('close', () => {
        this.wsAuthed = false;
        this.emit('ws:disconnected');
        this._scheduleWsReconnect();
      });

      ws.on('error', () => {
        // ignore (consumer will fall back to polling)
        this._scheduleWsReconnect();
      });

      // Safety: resolve even if auth doesn't come back quickly
      setTimeout(finish, 2500);
    });
  }

  async getQuota() {
    if (!this.token) throw new Error('not_authenticated');
    const r = await fetchJson(`${this.baseUrl}/client/quota`, {
      headers: { authorization: `Bearer ${this.token}` },
      timeoutMs: 6500
    });
    if (!r || !r.ok || !r.quota) throw new Error('quota_failed');
    const q = {
      remaining: Number(r.quota.remaining || 0),
      monthly_limit: Number(r.quota.monthly_limit || 15),
      copies_this_month: Number(r.quota.copies_this_month || 0),
      valid_until: r.quota.valid_until || null
    };
    this.cachedQuota = q;
    return q;
  }

  async decrementQuota() {
    if (!this.token) throw new Error('not_authenticated');
    const r = await fetchJson(`${this.baseUrl}/client/quota/decrement`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` },
      body: {},
      timeoutMs: 6500
    });
    if (!r || !r.ok || !r.quota) throw new Error('quota_failed');
    const q = {
      remaining: Number(r.quota.remaining || 0),
      monthly_limit: Number(r.quota.monthly_limit || 15),
      valid_until: r.quota.valid_until || null
    };
    this.cachedQuota = q;
    return q;
  }

  async logCopyFail() {
    if (!this.token) throw new Error('not_authenticated');
    const r = await fetchJson(`${this.baseUrl}/client/copy-log/fail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` },
      body: {},
      timeoutMs: 6500
    });
    if (!r || !r.ok) throw new Error('copy_fail_log_failed');
    return true;
  }

  async getLatestMasterDump() {
    if (!this.token) throw new Error('not_authenticated');
    const r = await fetchJson(`${this.baseUrl}/client/master-dump/latest`, {
      headers: { authorization: `Bearer ${this.token}` },
      timeoutMs: 6500
    });
    if (!r || !r.ok || !r.dump || !r.dump.dump_hex) throw new Error('no_master_dump');
    return { uid: r.dump.uid || null, dumpHex: String(r.dump.dump_hex), createdAt: r.dump.created_at || null };
  }

  async uploadMasterDump({ dumpHex, uid = null, siteId = null } = {}) {
    if (!this.token) throw new Error('not_authenticated');
    const r = await fetchJson(`${this.baseUrl}/api/client/master-dump`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` },
      body: { dump_hex: dumpHex, uid, siteId },
      timeoutMs: 10000
    });
    if (!r || !r.ok || !r.dump) throw new Error(String((r && r.error) || 'upload_failed'));
    return r.dump;
  }

  async getActiveDumpToCopy() {
    if (!this.token) throw new Error('not_authenticated');
    const r = await fetchJson(`${this.baseUrl}/client/dumps/active`, {
      headers: { authorization: `Bearer ${this.token}` },
      timeoutMs: 6500
    });
    if (!r || !r.ok || !r.dump || !r.dump.dump_hex) throw new Error('no_active_dump');
    return { uid: r.dump.uid || null, dumpHex: String(r.dump.dump_hex), createdAt: r.dump.created_at || null };
  }

  async adminSetActiveDump({ dumpHex, uid, source = 'manual' }) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/dumps/active`, {
      method: 'POST',
      headers,
      body: { dump_hex: dumpHex, uid, source },
      timeoutMs: 10000
    });
    if (!r || !r.ok) throw new Error('admin_set_active_dump_failed');
    return r.dump;
  }

  // --- Password reset (client) ---
  async requestPasswordReset(username) {
    await fetchJson(`${this.baseUrl}/auth/request-reset`, {
      method: 'POST',
      body: { username },
      timeoutMs: 6500
    });
    return { ok: true };
  }

  async confirmPasswordReset(token, newPassword) {
    await fetchJson(`${this.baseUrl}/auth/confirm-reset`, {
      method: 'POST',
      body: { token, new_password: newPassword },
      timeoutMs: 6500
    });
    return { ok: true };
  }

  // --- Admin ---
  _adminKey() {
    return process.env.PROPASS_ADMIN_KEY || process.env.ADMIN_API_KEY || '';
  }

  _adminHeaders() {
    // Prefer admin JWT when available (online-verified session), otherwise fall back to API key.
    if (this.token && this.role === 'admin') {
      return { authorization: `Bearer ${this.token}` };
    }
    const key = this._adminKey();
    if (!key) return null;
    return { 'x-admin-key': key };
  }

  async adminListClients() {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/clients`, {
      headers,
      timeoutMs: 6500
    });
    return (r && r.ok && Array.isArray(r.clients)) ? r.clients : [];
  }

  async adminCreateClient(payload) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/clients`, {
      method: 'POST',
      headers,
      body: payload || {},
      timeoutMs: 10000
    });
    if (!r || !r.ok || !r.client) throw new Error(String((r && r.error) || 'admin_create_client_failed'));
    return r;
  }

  async adminUpdateClient(id, payload) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/clients/${Number(id)}`, {
      method: 'PATCH',
      headers,
      body: payload || {},
      timeoutMs: 10000
    });
    if (!r || !r.ok || !r.client) throw new Error(String((r && r.error) || 'admin_update_client_failed'));
    return r.client;
  }

  async adminToggleClientStatus(id) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/clients/${Number(id)}/toggle`, {
      method: 'POST',
      headers,
      body: {},
      timeoutMs: 6500
    });
    if (!r || !r.ok || !r.client) throw new Error(String((r && r.error) || 'admin_toggle_client_failed'));
    return r.client;
  }

  async adminSendInvitationEmail(clientId) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/clients/${Number(clientId)}/send-invite`, {
      method: 'POST',
      headers,
      body: {},
      timeoutMs: 10000
    });
    if (!r || !r.ok) throw new Error(String((r && r.error) || 'admin_send_invite_failed'));
    return {
      sent: !!r.sent,
      error: r.error || null,
      resetUrl: r.resetUrl || null,
      expiresAt: r.expiresAt || r.expires_at || null,
      expires_at: r.expires_at || r.expiresAt || null
    };
  }

  async adminAddQuota({ clientId, username, addQuota, validityDays = 30 }) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/client/add-quota`, {
      method: 'POST',
      headers,
      body: { clientId, username, addQuota, validity_days: validityDays },
      timeoutMs: 6500
    });
    if (!r || !r.ok) throw new Error('admin_add_quota_failed');
    return r.client;
  }

  async adminUpsertMasterDump({ clientId, username, dumpHex, uid, source = 'manual', siteId = null }) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/master-dump`, {
      method: 'POST',
      headers,
      body: { clientId, username, dump_hex: dumpHex, uid, source, siteId },
      timeoutMs: 10000
    });
    if (!r || !r.ok) throw new Error('admin_master_dump_failed');
    return r.client;
  }

  async adminGetLatestMasterDump({ clientId, username }) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const qs = new URLSearchParams();
    if (clientId != null) qs.set('clientId', String(clientId));
    if (username) qs.set('username', String(username));
    const r = await fetchJson(`${this.baseUrl}/admin/master-dump/latest?${qs.toString()}`,
      {
        headers,
        timeoutMs: 6500
      }
    );
    if (!r || !r.ok || !r.dump || !r.dump.dump_hex) throw new Error('no_master_dump');
    return { uid: r.dump.uid || null, dumpHex: String(r.dump.dump_hex), createdAt: r.dump.created_at || null };
  }

  async adminListSites({ clientId, username }) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const qs = new URLSearchParams();
    if (clientId != null) qs.set('clientId', String(clientId));
    if (username) qs.set('username', String(username));
    const r = await fetchJson(`${this.baseUrl}/admin/sites?${qs.toString()}`,
      {
        headers,
        timeoutMs: 6500
      }
    );
    if (!r || !r.ok || !Array.isArray(r.sites)) throw new Error('admin_sites_failed');
    return r.sites;
  }

  async adminCreateSite({ clientId, username, name }) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/sites`, {
      method: 'POST',
      headers,
      body: { clientId, username, name },
      timeoutMs: 6500
    });
    if (!r || !r.ok || !Array.isArray(r.sites)) throw new Error(String((r && r.error) || 'admin_create_site_failed'));
    return r.sites;
  }

  async adminRenameSite({ siteId, name }) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/sites/${Number(siteId)}`, {
      method: 'PATCH',
      headers,
      body: { name },
      timeoutMs: 6500
    });
    if (!r || !r.ok) throw new Error(String((r && r.error) || 'admin_rename_site_failed'));
    return true;
  }

  async adminDeleteSite({ siteId }) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/sites/${Number(siteId)}`, {
      method: 'DELETE',
      headers,
      timeoutMs: 6500
    });
    if (!r || !r.ok) throw new Error(String((r && r.error) || 'admin_delete_site_failed'));
    return true;
  }

  async adminListAllSites() {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/sites/all`, {
      headers,
      timeoutMs: 6500
    });
    if (!r || !r.ok || !Array.isArray(r.sites)) throw new Error('admin_sites_all_failed');
    return r.sites;
  }

  async adminGetStats() {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/stats`, {
      headers,
      timeoutMs: 6500
    });
    if (!r || !r.ok || !r.stats) throw new Error('admin_stats_failed');
    return {
      totalClients: Number(r.stats.totalClients || 0),
      totalCopies: Number(r.stats.totalCopies || 0)
    };
  }

  async adminGetCopyStats(period = 'monthly') {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const qs = new URLSearchParams();
    qs.set('period', String(period === 'weekly' ? 'weekly' : 'monthly'));
    const r = await fetchJson(`${this.baseUrl}/admin/copy-stats?${qs.toString()}`,
      {
        headers,
        timeoutMs: 6500
      }
    );
    if (!r || !r.ok || !Array.isArray(r.labels)) throw new Error('admin_copy_stats_failed');
    return {
      period: String(r.period || period),
      labels: r.labels,
      success: Array.isArray(r.success) ? r.success.map((n) => Number(n || 0)) : [],
      fail: Array.isArray(r.fail) ? r.fail.map((n) => Number(n || 0)) : []
    };
  }

  async adminSyncCopyEvents(events = []) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const r = await fetchJson(`${this.baseUrl}/admin/copy-events/bulk`, {
      method: 'POST',
      headers,
      body: { events: Array.isArray(events) ? events : [] },
      timeoutMs: 10000
    });
    if (!r || !r.ok) throw new Error('admin_copy_events_failed');
    return { inserted: Number(r.inserted || 0) };
  }

  async adminGetLogs(filters = {}) {
    const headers = this._adminHeaders();
    if (!headers) throw new Error('admin_auth_missing');
    const qs = new URLSearchParams();
    if (filters.societe) qs.set('societe', String(filters.societe));
    if (filters.action) qs.set('action', String(filters.action));
    if (filters.dateDebut) qs.set('dateDebut', String(filters.dateDebut));
    if (filters.dateFin) qs.set('dateFin', String(filters.dateFin));
    if (filters.page) qs.set('page', String(filters.page));
    if (filters.limit) qs.set('limit', String(filters.limit));
    const r = await fetchJson(`${this.baseUrl}/admin/logs?${qs.toString()}`,
      {
        headers,
        timeoutMs: 10000
      }
    );
    if (!r || !r.ok) throw new Error('admin_logs_failed');
    return r;
  }
}

module.exports = {
  CloudClient
};
