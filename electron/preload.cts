import { contextBridge, ipcRenderer, shell } from 'electron';

// Allow-list URL schemes that we are willing to hand to the OS.
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function safeOpenExternal(url: string): void {
  try {
    const proto = new URL(url).protocol;
    if (!SAFE_PROTOCOLS.has(proto)) return;
    shell.openExternal(url);
  } catch {
    // not a parseable URL — drop it
  }
}

// Expose a minimal API to the renderer process.
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  openExternal: safeOpenExternal,
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
