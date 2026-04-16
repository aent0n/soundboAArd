const { app, BrowserWindow, ipcMain, dialog, globalShortcut, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const userDataPath = app.getPath('userData');
const configFilePath = path.join(userDataPath, 'soundboard_config.json');

let mainWindow = null;
let tray = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 1100,
    title: 'SoundboAArd',
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  mainWindow.on('close', function (event) {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      event.returnValue = false;
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  tray = new Tray(path.join(__dirname, 'icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Afficher', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quitter', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('SoundboAArd');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: Open File Dialog
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg'] }
    ]
  });
  if (canceled) {
    return null;
  } else {
    return filePaths[0];
  }
});

// IPC: Load Config
ipcMain.handle('config:load', () => {
  try {
    if (fs.existsSync(configFilePath)) {
      const data = fs.readFileSync(configFilePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return null;
});

// IPC: Save Config
ipcMain.handle('config:save', (event, newConfig) => {
  try {
    fs.writeFileSync(configFilePath, JSON.stringify(newConfig, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Failed to save config:', error);
    return false;
  }
});

// IPC: Save Record
ipcMain.handle('audio:saveRecord', async (event, arrayBuffer) => {
  const fileName = `record_${Date.now()}.webm`;
  const savePath = path.join(userDataPath, fileName);
  fs.writeFileSync(savePath, Buffer.from(arrayBuffer));
  return savePath;
});

// IPC: Save Snippet (WAV)
ipcMain.handle('audio:saveSnippet', async (event, arrayBuffer) => {
  const fileName = `snippet_${Date.now()}.wav`;
  const savePath = path.join(userDataPath, fileName);
  fs.writeFileSync(savePath, Buffer.from(arrayBuffer));
  return savePath;
});

// IPC: Register Global Shortcut
ipcMain.handle('shortcut:register', (event, { id, shortcut }) => {
  try {
    // Unregister if already present to avoid collisions
    globalShortcut.unregister(shortcut);
    const ret = globalShortcut.register(shortcut, () => {
      // Send event to the focused window (or the only window)
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send('shortcut:triggered', id);
      }
    });
    return ret;
  } catch (error) {
    console.error(`Error registering shortcut ${shortcut}:`, error);
    return false;
  }
});

// IPC: Unregister Global Shortcut
ipcMain.handle('shortcut:unregister', (event, shortcut) => {
  try {
    globalShortcut.unregister(shortcut);
    return true;
  } catch (e) {
    return false;
  }
});

// IPC: Unregister All Global Shortcuts (e.g. before reloading)
ipcMain.handle('shortcut:unregisterAll', () => {
  globalShortcut.unregisterAll();
  return true;
});

// IPC: Open NVIDIA Broadcast or URL
ipcMain.handle('util:openNvidia', async () => {
  const broadcastPath = 'C:\\Program Files\\NVIDIA Corporation\\NVIDIA Broadcast\\NVIDIA Broadcast.exe';
  if (fs.existsSync(broadcastPath)) {
    await shell.openPath(broadcastPath);
  } else {
    await shell.openExternal('https://www.nvidia.com/fr-fr/geforce/broadcasting/broadcast-app/');
  }
  return true;
});

app.on('will-quit', () => {
  // Unregister all shortcuts.
  globalShortcut.unregisterAll();
});
