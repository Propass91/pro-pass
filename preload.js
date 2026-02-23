const { contextBridge, ipcRenderer } = require('electron');

// Legacy bridge kept for existing tooling
contextBridge.exposeInMainWorld('ppc', {
  auth: {
    login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
    getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
    logout: () => ipcRenderer.invoke('auth:logout')
  },
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  runTask: (taskName, args) => ipcRenderer.invoke('ppc:run-task', taskName, args),
  nfcReadGen2: () => ipcRenderer.invoke('ppc:nfc-read-gen2'),
  nfcWriteGen2: (bufPath) => ipcRenderer.invoke('ppc:nfc-write-gen2', bufPath),
  hwStatus: () => ipcRenderer.invoke('ppc:hw-status-nfc'),
  onLog: (cb) => ipcRenderer.on('ppc:log', (_e, d) => cb(d)),
  onError: (cb) => ipcRenderer.on('ppc:error', (_e, d) => cb(d)),
  onHwStatus: (cb) => ipcRenderer.on('ppc:hw-status', (_e, d) => cb(d))
});

contextBridge.exposeInMainWorld('ppcResult', {
  getLastResult: () => ipcRenderer.invoke('ppc:get-last-result'),
  onWriteResult: (cb) => ipcRenderer.on('ppc:write-result', (_e, d) => cb(d)),
  getHistory: () => ipcRenderer.invoke('ppc:get-history'),
  exportHistory: () => ipcRenderer.invoke('ppc:export-history'),
  exportLog: (outPath) => ipcRenderer.invoke('ppc:export-log', outPath)
});

// New PROPASS UI contract
contextBridge.exposeInMainWorld('api', {
  getStats: async () => ipcRenderer.invoke('stats:getStats'),
  auth: {
    login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
    getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
    restoreSession: (payload) => ipcRenderer.invoke('auth:restoreSession', payload || {}),
    logout: () => ipcRenderer.invoke('auth:logout'),
    requestReset: (username) => ipcRenderer.invoke('auth:requestReset', { username }),
    confirmReset: (token, newPassword) => ipcRenderer.invoke('auth:confirmReset', { token, newPassword })
  },
  cloud: {
    isOnline: () => ipcRenderer.invoke('cloud:isOnline'),
    onQuotaUpdate: (cb) => {
      const h = (_event, q) => cb(q);
      ipcRenderer.on('cloud:quotaUpdate', h);
      return () => ipcRenderer.removeListener('cloud:quotaUpdate', h);
    }
  },
  nfc: {
    isConnected: async () => ipcRenderer.invoke('nfc:isConnected'),
    init: async () => ipcRenderer.invoke('nfc:init'),
    readDump: async () => ipcRenderer.invoke('nfc:readDump'),
    startPresenceWatch: async () => ipcRenderer.invoke('nfc:startPresenceWatch'),
    stopPresenceWatch: async () => ipcRenderer.invoke('nfc:stopPresenceWatch'),
    writeDump: async (data) => ipcRenderer.invoke('nfc:writeDump', data),
    writeDumpMagic: async (data) => ipcRenderer.invoke('nfc:writeDumpMagic', data),
    onPyLog: (cb) => {
      const h = (_event, line) => cb(line);
      ipcRenderer.on('nfc:pyLog', h);
      return () => ipcRenderer.removeListener('nfc:pyLog', h);
    },
    onCardPresent: (cb) => {
      const h = (_event, uid) => cb(uid);
      ipcRenderer.on('nfc:cardPresent', h);
      return () => ipcRenderer.removeListener('nfc:cardPresent', h);
    },
    onCardRemoved: (cb) => {
      const h = () => cb();
      ipcRenderer.on('nfc:cardRemoved', h);
      return () => ipcRenderer.removeListener('nfc:cardRemoved', h);
    }
  },
  dumps: {
    getQuota: async (payload) => {
      if (payload && typeof payload === 'object') {
        return ipcRenderer.invoke('dumps:getQuota', payload);
      }
      const u = await ipcRenderer.invoke('auth:getCurrentUser');
      const username = (u && (u.clientUsername || u.username)) || 'client1';
      return ipcRenderer.invoke('dumps:getQuota', { username });
    },
    getActiveDump: async () => {
      const u = await ipcRenderer.invoke('auth:getCurrentUser');
      const clientId = u && u.role === 'client' ? (u.id || null) : null;
      return ipcRenderer.invoke('dumps:getActiveDump', clientId);
    },
    onDumpUpdated: (cb) => {
      const h = (_event, payload) => cb(payload);
      ipcRenderer.on('dump:updated', h);
      return () => ipcRenderer.removeListener('dump:updated', h);
    },
    writeAdminDump: async (payload) => {
      if (payload && typeof payload === 'object') {
        return ipcRenderer.invoke('dumps:writeAdminDump', payload);
      }
      const u = await ipcRenderer.invoke('auth:getCurrentUser');
      const username = (u && (u.clientUsername || u.username)) || 'client1';
      return ipcRenderer.invoke('dumps:writeAdminDump', { username });
    }
    ,logCopyFail: async () => ipcRenderer.invoke('dumps:logCopyFail')
  },
  dump: {
    saveActive: async (adminToken, payload) => ipcRenderer.invoke('dump:saveActive', adminToken, payload || {})
  },
  sites: {
    getAll: async () => ipcRenderer.invoke('sites:getAll'),
    create: async (payload) => ipcRenderer.invoke('sites:create', payload || {})
  },
  admin: {
    login: async (password) => ipcRenderer.invoke('admin:login', password),
    getSessionToken: async () => ipcRenderer.invoke('admin:getSessionToken'),
    getDbPath: async (token) => ipcRenderer.invoke('admin:getDbPath', token),
    backupDb: async (token) => ipcRenderer.invoke('admin:backupDb', token),
    listClients: async (token) => ipcRenderer.invoke('admin:listClients', token),
    listSites: async (token, payload) => ipcRenderer.invoke('admin:listSites', token, payload || {}),
    createSite: async (token, payload) => ipcRenderer.invoke('admin:createSite', token, payload || {}),
    renameSite: async (token, payload) => ipcRenderer.invoke('admin:renameSite', token, payload || {}),
    deleteSite: async (token, payload) => ipcRenderer.invoke('admin:deleteSite', token, payload || {}),
    listAllSites: async (token) => ipcRenderer.invoke('admin:listAllSites', token),
    addQuota: async (token, payload) => ipcRenderer.invoke('admin:addQuota', token, payload || {}),
    createMasterDump: async (token, payload) => ipcRenderer.invoke('admin:createMasterDump', token, payload || {}),
    testCopy: async (token, payload) => ipcRenderer.invoke('admin:testCopy', token, payload || {}),
    getStats: async () => ipcRenderer.invoke('admin:getStats'),
    getCopyStats: async (period) => ipcRenderer.invoke('admin:getCopyStats', period),
    syncCopyEvents: async (events) => ipcRenderer.invoke('admin:syncCopyEvents', events),
    getClients: async () => ipcRenderer.invoke('admin:getClients'),
    createClient: async (data) => ipcRenderer.invoke('admin:createClient', data || {}),
    updateClient: async (id, data) => ipcRenderer.invoke('admin:updateClient', id, data || {}),
    toggleClientStatus: async (id) => ipcRenderer.invoke('admin:toggleClientStatus', id),
    sendInvitationEmail: async (clientId) => ipcRenderer.invoke('admin:sendInvitationEmail', clientId),
    getAdminLogs: async (token) => ipcRenderer.invoke('admin:getAdminLogs', token),
    getLogs: async (filters) => ipcRenderer.invoke('admin:getLogs', filters || {}),
    exportLogs: async (filters) => ipcRenderer.invoke('admin:exportLogs', filters || {}),
    onLog: (cb) => {
      const h = (_event, line) => cb(line);
      ipcRenderer.on('admin:log', h);
      return () => ipcRenderer.removeListener('admin:log', h);
    }
  },
  stats: {
    getDashboard: async () => ipcRenderer.invoke('stats:getStats')
  }
});
