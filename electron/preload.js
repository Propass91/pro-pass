const { contextBridge, ipcRenderer } = require('electron');

const api = {
  auth: {
    login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  },
  dashboard: {
    getStats: () => ipcRenderer.invoke('dashboard:getStats'),
    getRecentCopies: () => ipcRenderer.invoke('dashboard:getRecentCopies'),
  },
  matrix: {
    sync: () => ipcRenderer.invoke('matrix:sync'),
    readLog: () => ipcRenderer.invoke('matrix:readLog'),
  },
};

contextBridge.exposeInMainWorld('api', api);
