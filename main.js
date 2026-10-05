const { app, BrowserWindow, Menu, ipcMain, dialog, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

nativeTheme.themeSource = 'dark';

let win;
let dirty = false;
let forceClose = false;
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 820,
    minHeight: 520,
    backgroundColor: '#14161b',
    title: 'Tally',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1d23', symbolColor: '#cfd3dc', height: 36 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('close', (e) => {
    if (dirty && !forceClose) {
      e.preventDefault();
      win.webContents.send('request-close');
    }
  });
}

Menu.setApplicationMenu(null);

ipcMain.on('dirty', (_e, v) => { dirty = !!v; });
ipcMain.on('quit', () => { forceClose = true; app.quit(); });

ipcMain.handle('cfg:load', () => {
  try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch { return { projects: [] }; }
});
ipcMain.handle('cfg:save', (_e, cfg) => {
  fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
  fs.writeFileSync(cfgPath(), JSON.stringify(cfg));
});

ipcMain.handle('dlg:openSheet', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Sheet', extensions: ['sheet'] }], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dlg:dir', async (_e, create) => {
  const r = await dialog.showOpenDialog(win, {
    title: create ? 'Choose where to create the project' : 'Open project folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dlg:saveAs', async (_e, dir, name) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: dir ? path.join(dir, name) : name,
    filters: [{ name: 'Sheet', extensions: ['sheet'] }],
  });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('dlg:unsaved', async () => {
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2,
    message: 'This sheet has unsaved changes.',
  });
  return ['save', 'discard', 'cancel'][r.response];
});

ipcMain.handle('fs:read', (_e, p) => fs.readFileSync(p, 'utf8'));
ipcMain.handle('fs:write', (_e, p, text) => { fs.writeFileSync(p, text); });
ipcMain.handle('fs:list', (_e, p) => {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || d.name.endsWith('.sheet')))
      .map((d) => ({ name: d.name, path: path.join(p, d.name), dir: d.isDirectory() }))
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch { return []; }
});
ipcMain.handle('fs:mkdir', (_e, parent, name) => {
  const p = path.join(parent, name);
  if (fs.existsSync(p)) return { error: 'That name already exists.' };
  fs.mkdirSync(p, { recursive: true });
  return { path: p };
});
ipcMain.handle('fs:newSheet', (_e, parent, name) => {
  const p = path.join(parent, name);
  if (fs.existsSync(p)) return { error: 'That name already exists.' };
  fs.writeFileSync(p, JSON.stringify({ version: 1, cells: {} }));
  return { path: p };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
