module.exports = function (ipcMain) {
  const { registerHandlers } = require('./electron/ipc/handlers');
  return registerHandlers(ipcMain);
};
