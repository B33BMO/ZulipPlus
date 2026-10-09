// Single entry point for shell-specific behaviour.
//
//     import { platform } from '@/app/platform';
//     await platform.openExternal(url);
//
// Adding a new shell means writing one class here and adding a line to
// `detectPlatform()` — no call sites change. That's the point: it's what
// makes a Tauri port a swap rather than a hunt.

import { ElectronPlatform, getElectronBridge } from './electron';
import { WebPlatform } from './web';
import type { Platform } from './types';

export type {
  NotifyOptions,
  Platform,
  PlatformName,
  SecureCredentialStore,
  StoredCredentials,
} from './types';

function detectPlatform(): Platform {
  const electron = getElectronBridge();
  if (electron) return new ElectronPlatform(electron);
  // Next shell slots in here:
  //   if (getTauriBridge()) return new TauriPlatform();
  return new WebPlatform();
}

/**
 * The active shell. Resolved once at module load — the host can't change
 * underneath a running renderer.
 */
export const platform: Platform = detectPlatform();
