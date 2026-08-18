// Plain-browser implementation. Used by `npm run dev` in a browser tab, and
// as the base class the Electron adapter extends — anything a native shell
// doesn't override falls back to these web APIs.
//
// All API traffic goes through Vite's `/zulip-api` proxy (see vite.config.ts),
// because a browser can't talk to an arbitrary Zulip server directly without
// that server opting into CORS.

import type { NotifyOptions, Platform, PlatformName, SecureCredentialStore } from './types';

/** Strip trailing slashes so `${base}${path}` never doubles up. */
export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function isAbsoluteUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export class WebPlatform implements Platform {
  readonly name: PlatformName = 'web';
  // Widened rather than inferred as literals so native subclasses can override.
  readonly isDesktop: boolean = false;
  readonly os: string = 'browser';
  readonly secureCredentials: SecureCredentialStore | null = null;

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async focusWindow(): Promise<void> {
    window.focus();
  }

  async requestNotificationPermission(): Promise<void> {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    try {
      await Notification.requestPermission();
    } catch {
      // Safari's callback-only form, or a policy block. Not fatal.
    }
  }

  async notify(opts: NotifyOptions): Promise<boolean> {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return false;
    }
    try {
      const note = new Notification(opts.title, {
        body: opts.body,
        icon: opts.icon,
        tag: opts.tag,
      });
      note.onclick = () => {
        void this.focusWindow();
        note.close();
      };
      return true;
    } catch {
      // Some engines reject the options bag (e.g. an icon they can't load).
      // A bare title+body notification is better than none.
      try {
        // eslint-disable-next-line no-new
        new Notification(opts.title, { body: opts.body });
        return true;
      } catch {
        return false;
      }
    }
  }

  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init);
  }

  async setServerOrigin(_serverUrl: string): Promise<void> {
    // Nothing to scope — the browser enforces its own origin rules.
  }

  apiBaseUrl(_serverUrl: string): string {
    return '/zulip-api/api/v1';
  }

  assetUrl(_serverUrl: string, path: string): string {
    if (!path) return '';
    if (isAbsoluteUrl(path)) return path;
    return `/zulip-api${path}`;
  }
}
