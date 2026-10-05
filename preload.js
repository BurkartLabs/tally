const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  loadCfg: inv('cfg:load'),
  saveCfg: inv('cfg:save'),
  pickSheet: inv('dlg:openSheet'),
  pickDir: inv('dlg:dir'),
  saveAsDialog: inv('dlg:saveAs'),
  askUnsaved: inv('dlg:unsaved'),
  read: inv('fs:read'),
  write: inv('fs:write'),
  list: inv('fs:list'),
  mkdir: inv('fs:mkdir'),
  newSheet: inv('fs:newSheet'),
  setDirty: (v) => ipcRenderer.send('dirty', v),
  quit: () => ipcRenderer.send('quit'),
  onRequestClose: (cb) => ipcRenderer.on('request-close', cb),
});
