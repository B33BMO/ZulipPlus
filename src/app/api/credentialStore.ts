// Persisted Zulip credentials (server URL, email, API key).
//
// Storage policy, in order of preference:
//   1. The platform's secure store — Electron hands these to the main
//      process, which encrypts via OS-level safeStorage (Keychain / DPAPI /
//      libsecret). Never touches localStorage at rest.
//   2. Plaintext localStorage. Browser-only dev, or a desktop box with no
//      usable keyring. Acceptable for a developer workflow, NOT for a
//      shipped build.
//
// The first call after upgrade also migrates any pre-existing
// localStorage.zulip_credentials into the secure store and clears the
// plaintext copy.
//
// Which store is available is a platform question, so it's answered in
// `src/app/platform/`; this module only owns the fallback + migration policy.

import { platform } from '../platform';
import type { StoredCredentials } from '../platform';

export type ZulipCredentials = StoredCredentials;

const LS_KEY = 'zulip_credentials';

export async function loadCredentials(): Promise<ZulipCredentials | null> {
  const plaintext = readLocalStorage();
  const secure = platform.secureCredentials;
  if (secure) {
    try {
      // One-time migration: promote a plaintext copy left over from before
      // the secure store existed, then wipe it.
      if (plaintext && (await secure.isAvailable())) {
        if (await secure.set(plaintext)) {
          localStorage.removeItem(LS_KEY);
        }
      }
      const stored = await secure.get();
      if (stored) return stored;
    } catch {
      // Fall through to localStorage.
    }
  }
  return plaintext;
}

export async function saveCredentials(creds: ZulipCredentials): Promise<void> {
  const secure = platform.secureCredentials;
  if (secure) {
    try {
      if (await secure.set(creds)) {
        // Belt + braces: drop any leftover plaintext copy from before we
        // migrated to the secure store.
        localStorage.removeItem(LS_KEY);
        return;
      }
    } catch {
      // Fall through.
    }
  }
  // Browser-only dev, or no keyring — last resort.
  localStorage.setItem(LS_KEY, JSON.stringify(creds));
}

export async function clearCredentials(): Promise<void> {
  const secure = platform.secureCredentials;
  if (secure) {
    try {
      await secure.clear();
    } catch {
      // Best effort — still drop the plaintext copy below.
    }
  }
  localStorage.removeItem(LS_KEY);
}

function readLocalStorage(): ZulipCredentials | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.apiKey === 'string' && parsed.apiKey) {
      return parsed as ZulipCredentials;
    }
    return null;
  } catch {
    return null;
  }
}
