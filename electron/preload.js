const { contextBridge, ipcRenderer } = require('electron');

const api = {
  auth: {
    login: (u, p) => ipcRenderer.invoke('auth:login', u, p),
    restoreSession: (payload) => ipcRenderer.invoke('auth:restoreSession', payload),
    getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    requestReset: (payload) => ipcRenderer.invoke('auth:requestReset', payload),
    confirmReset: (payload) => ipcRenderer.invoke('auth:confirmReset', payload),
  },
  dashboard: {
    getStats: () => ipcRenderer.invoke('dashboard:getStats'),
    getRecentCopies: () => ipcRenderer.invoke('dashboard:getRecentCopies'),
  },
  matrix: {
    sync: () => ipcRenderer.invoke('matrix:sync'),
    readLog: () => ipcRenderer.invoke('matrix:readLog'),
  },
  nfc: {
    init: () => ipcRenderer.invoke('nfc:init'),
    isConnected: () => ipcRenderer.invoke('nfc:isConnected'),
    startPresenceWatch: () => ipcRenderer.invoke('nfc:startPresenceWatch'),
    stopPresenceWatch: () => ipcRenderer.invoke('nfc:stopPresenceWatch'),
    readDump: () => ipcRenderer.invoke('nfc:readDump'),
    writeDump: (hex) => ipcRenderer.invoke('nfc:writeDump', hex),
    clearVault: () => ipcRenderer.invoke('nfc:clearVault'),
    vaultExists: () => ipcRenderer.invoke('nfc:vaultExists'),
    onCardPresent: (cb) => { ipcRenderer.on('nfc:cardPresent', (_e, uid) => cb(uid)); return () => ipcRenderer.removeAllListeners('nfc:cardPresent'); },
    onCardRemoved: (cb) => { ipcRenderer.on('nfc:cardRemoved', () => cb()); return () => ipcRenderer.removeAllListeners('nfc:cardRemoved'); },
    onPyLog: (cb) => { ipcRenderer.on('nfc:pyLog', (_e, msg) => cb(msg)); return () => ipcRenderer.removeAllListeners('nfc:pyLog'); },
    onLog: (cb) => {
      const h1 = (_e, msg) => cb(msg);
      const h2 = (_e, msg) => cb(msg);
      ipcRenderer.on('nfc:pyLog', h1);
      ipcRenderer.on('nfc:log', h2);
      return () => {
        ipcRenderer.removeListener('nfc:pyLog', h1);
        ipcRenderer.removeListener('nfc:log', h2);
      };
    },
  },
  cloud: {
    isOnline: () => ipcRenderer.invoke('cloud:isOnline'),
    onQuotaUpdate: (cb) => { ipcRenderer.on('cloud:quotaUpdate', (_e, q) => cb(q)); return () => ipcRenderer.removeAllListeners('cloud:quotaUpdate'); },
  },
  dumps: {
    getActiveDump: async () => {
      const u = await ipcRenderer.invoke('auth:getCurrentUser');
      const clientId = u && u.role === 'client' ? (u.id || null) : null;
      return ipcRenderer.invoke('dumps:getActiveDump', clientId);
    },
    getQuota: () => ipcRenderer.invoke('dumps:getQuota'),
    syncNow: (clientId) => ipcRenderer.invoke('dumps:syncNow', clientId),
    writeAdminDump: (p) => ipcRenderer.invoke('dumps:writeAdminDump', p),
    logCopyFail: () => ipcRenderer.invoke('dumps:logCopyFail'),
    onDumpUpdated: (cb) => {
      const h1 = (_e, p) => cb(p);
      const h2 = (_e, p) => cb(p);
      ipcRenderer.on('dumps:dumpUpdated', h1);
      ipcRenderer.on('dump:updated', h2);
      return () => {
        ipcRenderer.removeListener('dumps:dumpUpdated', h1);
        ipcRenderer.removeListener('dump:updated', h2);
      };
    },
  },
  admin: {
    login: (pw) => ipcRenderer.invoke('admin:login', pw),
    getSessionToken: () => ipcRenderer.invoke('admin:getSessionToken'),
    listClients: (t) => ipcRenderer.invoke('admin:listClients', t),
    addQuota: (t, p) => ipcRenderer.invoke('admin:addQuota', t, p),
    createMasterDump: (t, p) => ipcRenderer.invoke('admin:createMasterDump', t, p),
    getStats: () => ipcRenderer.invoke('admin:getStats'),
    getCopyStats: (period) => ipcRenderer.invoke('admin:getCopyStats', period),
    getClients: () => ipcRenderer.invoke('admin:getClients'),
    createClient: (p) => ipcRenderer.invoke('admin:createClient', p),
    updateClient: (id, p) => ipcRenderer.invoke('admin:updateClient', id, p),
    toggleClientStatus: (id) => ipcRenderer.invoke('admin:toggleClientStatus', id),
    sendInvitationEmail: (id) => ipcRenderer.invoke('admin:sendInvitationEmail', id),
    listSites: (t, p) => ipcRenderer.invoke('admin:listSites', t, p),
    createSite: (t, p) => ipcRenderer.invoke('admin:createSite', t, p),
    renameSite: (t, p) => ipcRenderer.invoke('admin:renameSite', t, p),
    deleteSite: (t, p) => ipcRenderer.invoke('admin:deleteSite', t, p),
    listAllSites: (t) => ipcRenderer.invoke('admin:listAllSites', t),
    testCopy: (t, p) => ipcRenderer.invoke('admin:testCopy', t, p),
    syncCopyEvents: (e) => ipcRenderer.invoke('admin:syncCopyEvents', e),
    getDbPath: (t) => ipcRenderer.invoke('admin:getDbPath', t),
    backupDb: (t) => ipcRenderer.invoke('admin:backupDb', t),
    getLogs: (f) => ipcRenderer.invoke('admin:getLogs', f),
    exportLogs: (f) => ipcRenderer.invoke('admin:exportLogs', f),
    getAdminLogs: (t) => ipcRenderer.invoke('admin:getAdminLogs', t),
  },
  sites: {
    getAll: () => ipcRenderer.invoke('sites:getAll'),
    create: (p) => ipcRenderer.invoke('sites:create', p),
  },
};

contextBridge.exposeInMainWorld('api', api);

