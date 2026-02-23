const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initDatabase } = require('./database/database');
const { setupIPCHandlers } = require('./ipc/handlers');

let mainWindow;

async function createWindow() {
  await initDatabase();
  setupIPCHandlers();
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  
  // Ouvre DevTools pour debug
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
