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
});
