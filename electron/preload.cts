import { contextBridge, ipcRenderer } from 'electron';

// NOTE: BrowserWindow runs with `sandbox: true`, which restricts the
// preload to a small subset of Electron APIs (contextBridge, ipcRenderer,
// limited webFrame). The `shell` module is unavailable here — anything
// that touches the OS has to round-trip through IPC to the main process.

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  showNotification: (opts: { title: string; body: string; icon?: string }) =>
    ipcRenderer.invoke('show-notification', opts),
  setServerUrl: (url: string) => ipcRenderer.invoke('set-server-url', url),
  creds: {
    available: (): Promise<boolean> => ipcRenderer.invoke('creds:available'),
    get: <T = unknown,>(): Promise<T | null> => ipcRenderer.invoke('creds:get'),
    set: (payload: unknown): Promise<boolean> => ipcRenderer.invoke('creds:set', payload),
    clear: (): Promise<void> => ipcRenderer.invoke('creds:clear'),
  },
});
