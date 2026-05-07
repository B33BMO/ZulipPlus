// Persisted Zulip credentials (server URL, email, API key).
//
// Storage strategy:
//   1. Electron (preferred): hand to the main process, which encrypts via
//      OS-level safeStorage (Keychain / DPAPI / libsecret). Never touches
//      the renderer's localStorage at rest.
//   2. Browser-only dev OR no OS keyring: fall back to plaintext
//      localStorage. The renderer is sandboxed so this is acceptable for
//      a developer workflow but NOT for shipped builds.
//
// The first call after upgrade also migrates any pre-existing
// localStorage.zulip_credentials into the encrypted store and clears the
// plaintext copy.

export interface ZulipCredentials {
  server: string;
  email: string;
  apiKey: string;
}

const LS_KEY = 'zulip_credentials';

interface ElectronCredsAPI {
  available: () => Promise<boolean>;
  get: <T = unknown>() => Promise<T | null>;
  set: (payload: unknown) => Promise<boolean>;
  clear: () => Promise<void>;
}

function ipc(): ElectronCredsAPI | null {
  const api = (window as unknown as { electronAPI?: { creds?: ElectronCredsAPI } }).electronAPI;
  return api?.creds ?? null;
}

export async function loadCredentials(): Promise<ZulipCredentials | null> {
  // One-time migration: if the renderer has plaintext creds in localStorage
  // and Electron's encrypted store is available, promote them and wipe.
  const plaintext = readLocalStorage();
  const creds = ipc();
  if (creds) {
    try {
      if (plaintext && (await creds.available())) {
        await creds.set(plaintext);
        localStorage.removeItem(LS_KEY);
      }
      const v = await creds.get<ZulipCredentials>();
      if (v && typeof v === 'object' && (v as ZulipCredentials).apiKey) return v;
    } catch {
      // fall through to localStorage
    }
  }
  return plaintext;
}

export async function saveCredentials(creds: ZulipCredentials): Promise<void> {
  const ipcCreds = ipc();
  if (ipcCreds) {
    try {
      const ok = await ipcCreds.set(creds);
      if (ok) {
        // Belt + braces: drop any leftover plaintext copy from before
        // we migrated to safeStorage.
        localStorage.removeItem(LS_KEY);
        return;
      }
    } catch {
      // fall through
    }
  }
  // Browser-only dev or no keyring — last resort.
  localStorage.setItem(LS_KEY, JSON.stringify(creds));
}

export async function clearCredentials(): Promise<void> {
  const ipcCreds = ipc();
  if (ipcCreds) {
    try { await ipcCreds.clear(); } catch { /* ignore */ }
  }
  localStorage.removeItem(LS_KEY);
}

function readLocalStorage(): ZulipCredentials | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.apiKey) {
      return parsed as ZulipCredentials;
    }
    return null;
  } catch {
    return null;
  }
}
