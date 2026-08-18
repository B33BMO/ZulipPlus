// Electron implementation. Everything here talks to the preload bridge
// (`electron/preload.cts`) over IPC — the BrowserWindow runs with
// `sandbox: true`, so the renderer can't touch the OS itself.
//
// Anything Electron doesn't do better than the browser is inherited from
// WebPlatform.

import type { NotifyOptions, PlatformName, SecureCredentialStore, StoredCredentials } from './types';
import { WebPlatform, isAbsoluteUrl, trimTrailingSlash } from './web';

interface ElectronCredsBridge {
  available: () => Promise<boolean>;
  get: <T = unknown>() => Promise<T | null>;
  set: (payload: unknown) => Promise<boolean>;
  clear: () => Promise<void>;
}

export interface ElectronBridge {
  platform: string;
  isElectron: true;
  openExternal: (url: string) => Promise<void>;
  focusWindow: () => Promise<void>;
  showNotification: (opts: { title: string; body: string; icon?: string }) => Promise<boolean>;
  setServerUrl: (url: string) => Promise<void>;
  creds?: ElectronCredsBridge;
}

export function getElectronBridge(): ElectronBridge | null {
  const bridge = (globalThis as { electronAPI?: ElectronBridge }).electronAPI;
  return bridge?.isElectron ? bridge : null;
}

class ElectronCredentialStore implements SecureCredentialStore {
  constructor(private readonly creds: ElectronCredsBridge) {}

  isAvailable(): Promise<boolean> {
    return this.creds.available();
  }

  async get(): Promise<StoredCredentials | null> {
    const v = await this.creds.get<StoredCredentials>();
    // The main process hands back whatever it decrypted; make sure it's
    // actually shaped like credentials before trusting it.
    if (v && typeof v === 'object' && typeof v.apiKey === 'string' && v.apiKey) {
      return v;
    }
    return null;
  }

  set(creds: StoredCredentials): Promise<boolean> {
    return this.creds.set(creds);
  }

  clear(): Promise<void> {
    return this.creds.clear();
  }
}

export class ElectronPlatform extends WebPlatform {
  readonly name: PlatformName = 'electron';
  readonly isDesktop = true;
  readonly os: string;
  readonly secureCredentials: SecureCredentialStore | null;

  // In dev the renderer is served by Vite on localhost, so API calls still go
  // through its `/zulip-api` proxy. Only a packaged build talks to the Zulip
  // server directly (which is what the CORS shim in main.cts exists for).
  private readonly directToServer = !import.meta.env.DEV;

  constructor(private readonly bridge: ElectronBridge) {
    super();
    this.os = bridge.platform || 'unknown';
    this.secureCredentials = bridge.creds
      ? new ElectronCredentialStore(bridge.creds)
      : null;
  }

  async openExternal(url: string): Promise<void> {
    // Routed through IPC because `shell` is unavailable in a sandboxed
    // preload — calling it there silently no-ops.
    await this.bridge.openExternal(url);
  }

  async focusWindow(): Promise<void> {
    await this.bridge.focusWindow();
  }

  async requestNotificationPermission(): Promise<void> {
    // The main process owns notifications here; no renderer permission needed.
  }

  async notify(opts: NotifyOptions): Promise<boolean> {
    try {
      // Main-process notifications are markedly more reliable on Windows than
      // the renderer's web Notification API.
      const shown = await this.bridge.showNotification({
        title: opts.title,
        body: opts.body,
        icon: opts.icon,
      });
      if (shown) return true;
    } catch {
      // Fall through to the web implementation below.
    }
    return super.notify(opts);
  }

  async setServerOrigin(serverUrl: string): Promise<void> {
    // Lets main.cts scope its Origin/CORS header rewrites to this one origin
    // instead of every request the renderer makes.
    try {
      await this.bridge.setServerUrl(serverUrl);
    } catch {
      // Older preload without the handler — the shim just stays unscoped.
    }
  }

  apiBaseUrl(serverUrl: string): string {
    if (!this.directToServer) return super.apiBaseUrl(serverUrl);
    return `${trimTrailingSlash(serverUrl)}/api/v1`;
  }

  assetUrl(serverUrl: string, path: string): string {
    if (!path) return '';
    if (isAbsoluteUrl(path)) return path;
    if (!this.directToServer) return super.assetUrl(serverUrl, path);
    return `${trimTrailingSlash(serverUrl)}${path}`;
  }
}
