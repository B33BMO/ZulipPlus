// The contract between the React app and whatever shell it happens to be
// running inside (Electron today, Tauri tomorrow, a plain browser in dev).
//
// Rule of thumb: if a call would behave differently under a different shell,
// it belongs here. Nothing outside `src/app/platform/` should reach for
// `window.electronAPI`, branch on `import.meta.env.DEV` to build a URL, or
// construct a `Notification` directly.

export interface NotifyOptions {
  title: string;
  body: string;
  /** Absolute URL or local path to an icon. Best-effort; shells may ignore it. */
  icon?: string;
  /** Collapse key — a later notification with the same tag replaces the earlier. */
  tag?: string;
}

export interface StoredCredentials {
  server: string;
  email: string;
  apiKey: string;
}

/** A place to keep the Zulip API key. Only implemented where it's encrypted at rest. */
export interface SecureCredentialStore {
  /** False when the OS keyring is missing (headless Linux, no libsecret, …). */
  isAvailable(): Promise<boolean>;
  get(): Promise<StoredCredentials | null>;
  /** Resolves false if the write couldn't be made securely — caller should fall back. */
  set(creds: StoredCredentials): Promise<boolean>;
  clear(): Promise<void>;
}

export type PlatformName = 'electron' | 'tauri' | 'web';

export interface Platform {
  readonly name: PlatformName;
  /** True in a native shell — i.e. OS notifications and a keyring are plausible. */
  readonly isDesktop: boolean;
  /** `process.platform`-style id ('win32', 'darwin', 'linux') or 'browser'. */
  readonly os: string;

  // ── Windowing / shell ──────────────────────────────────
  /** Open a URL in the user's default browser, never in-app. */
  openExternal(url: string): Promise<void>;
  /** Raise and focus the app window (used by notification clicks). */
  focusWindow(): Promise<void>;

  // ── Notifications ──────────────────────────────────────
  /** Ask for permission if the shell needs it. Safe to call repeatedly. */
  requestNotificationPermission(): Promise<void>;
  /** Show a notification. Resolves false if it couldn't be shown. */
  notify(opts: NotifyOptions): Promise<boolean>;

  // ── Networking ─────────────────────────────────────────
  // Every HTTP call in the app goes through this. Under Electron it's the
  // renderer's own fetch (with the main process rewriting CORS headers);
  // under Tauri it will be the Rust-side HTTP client, where CORS doesn't
  // apply at all and the header-rewriting shim can be deleted outright.
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;

  /**
   * Tell the shell which origin the Zulip server lives at, so it can scope
   * any origin-specific handling to that one host. No-op where unneeded.
   */
  setServerOrigin(serverUrl: string): Promise<void>;

  /** Base URL for `/api/v1` requests against `serverUrl`. */
  apiBaseUrl(serverUrl: string): string;
  /**
   * Absolute, fetchable URL for a server-relative asset path such as
   * `/user_uploads/…`. Passes absolute URLs through untouched.
   */
  assetUrl(serverUrl: string, path: string): string;

  // ── Storage ────────────────────────────────────────────
  /** Null when this shell has no OS-backed secret storage; caller falls back. */
  readonly secureCredentials: SecureCredentialStore | null;
}
