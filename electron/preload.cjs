const { contextBridge, ipcRenderer } = require('electron');
const invoke = (method, args) => ipcRenderer.invoke('line-agent', method, args);
contextBridge.exposeInMainWorld(
  'lineAgent',
  Object.freeze({
    state: () => invoke('state'),
    status: () => invoke('status'),
    recent: (query) => invoke('recent', query),
    saveChats: (refs) => invoke('saveChats', refs),
    setEnabled: (enabled) => invoke('setEnabled', enabled),
    read: (args) => invoke('read', args),
    work: () => invoke('work'),
    editWork: (args) => invoke('editWork', args),
    mergeWork: (args) => invoke('mergeWork', args),
    saveRules: (args) => invoke('saveRules', args),
    connection: () => invoke('connection'),
    testMcp: () => invoke('testMcp'),
    copy: (text) => invoke('copy', text),
    openSettings: () => invoke('openSettings'),
    onClosing: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('operation-in-progress', listener);
      return () => ipcRenderer.removeListener('operation-in-progress', listener);
    },
    onWorkChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('work-changed', listener);
      return () => ipcRenderer.removeListener('work-changed', listener);
    },
  }),
);
