import { app, BrowserWindow, ipcMain, Notification, safeStorage, session, shell } from 'electron';
import { promises as fsp } from 'fs';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

// Required for Windows toast notifications. Without this, `new Notification()`
// in the renderer is silently dropped on Windows.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.zulipplus.client');
}

// Schemes the renderer can navigate to in-app. Anything else is shelled out.
const APP_ORIGINS = new Set([
  'http://localhost:5173',
  'file://',
]);

function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return true;
    return APP_ORIGINS.has(`${u.protocol}//${u.host}`);
  } catch {
    return false;
  }
}

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
function safeOpenExternal(url: string): void {
  try {
    const u = new URL(url);
    if (SAFE_EXTERNAL_PROTOCOLS.has(u.protocol)) {
      shell.openExternal(url);
    }
  } catch {
    // not a parseable URL — drop
  }
}

// Strict-ish CSP. We can't pin connect-src to a specific Zulip server because
// users self-host (and may use plain http on private networks), so we constrain
// the dangerous knobs (script execution, frames, objects, base) and allow both
// http and https for outbound connects/images.
const CSP = [
  "default-src 'self'",
  // Vite's runtime + React DevTools need inline + eval in dev. In prod we
  // could tighten further; keeping inline for TipTap styles.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "media-src 'self' blob: http: https:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: wss: ws://localhost:5173",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// Origin of the currently configured Zulip server (e.g. "https://zulip.example.com").
// Set by the renderer via the `set-server-url` IPC after credentials are known.
// Used to scope the Origin/CORS header rewrites below to that one origin instead
// of every renderer-initiated request.
let zulipServerOrigin: string | null = null;

function urlOrigin(u: string): string | null {
  try { return new URL(u).origin; } catch { return null; }
}

// True if the request belongs to the configured Zulip server. Pre-login
// (no origin set yet) we allow rewrites for any http(s) request so the
// initial login call itself can succeed.
function isZulipBound(url: string): boolean {
  if (!zulipServerOrigin) {
    const o = urlOrigin(url);
    return o ? (o.startsWith('http://') || o.startsWith('https://')) : false;
  }
  return urlOrigin(url) === zulipServerOrigin;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Zulip',
    icon: path.join(__dirname, '../public/zulip_logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    // Frameless with custom title bar look (Windows)
    backgroundColor: '#313338',
    show: false,
  });

  // CORS bypass for the Zulip API. Scoped two ways:
  //   1. webContentsId must match our window (ignore other tabs/extensions).
  //   2. Request URL must be Zulip-bound (matches `zulipServerOrigin` once set).
  // Without (2) we'd be force-allowing CORS on every third-party fetch the
  // renderer makes (image CDNs, GIPHY, etc.) which is a real blast-radius bug.
  const ses = mainWindow.webContents.session;
  const ourWebContentsId = mainWindow.webContents.id;

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.webContentsId !== ourWebContentsId || !isZulipBound(details.url)) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    callback({ requestHeaders: { ...details.requestHeaders, Origin: '*' } });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers: Record<string, string[] | string> = { ...details.responseHeaders };
    // Inject CSP on document loads of our app pages.
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      headers['Content-Security-Policy'] = [CSP];
    }
    if (details.webContentsId === ourWebContentsId && isZulipBound(details.url)) {
      headers['Access-Control-Allow-Origin'] = ['*'];
      headers['Access-Control-Allow-Headers'] = ['*'];
      headers['Access-Control-Allow-Methods'] = ['*'];
    }
    callback({ responseHeaders: headers });
  });

  if (isDev) {
    // In dev, load from the Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Block in-app navigation to anything outside our origin. A malicious link
  // that lands here gets shelled out to the user's browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    safeOpenExternal(url);
  });

  // Belt + suspenders: if a webview/<iframe> tries to attach, drop it.
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  // Open external links in the default browser, with a scheme allow-list.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Renderer announces the configured Zulip server origin so we can scope the
// Origin/CORS header rewrites above to that one origin. Idempotent; called
// post-login and on auto-login from cached creds.
ipcMain.handle('set-server-url', (_evt, url: string) => {
  if (typeof url !== 'string') return;
  const origin = urlOrigin(url);
  if (origin) zulipServerOrigin = origin;
});

// Focus the main window (used by notification click handlers).
ipcMain.handle('focus-window', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// ── Credential storage ────────────────────────────────
// We persist the Zulip API key via Electron's safeStorage (OS-level
// encrypted: macOS Keychain, Windows DPAPI, libsecret on Linux). The
// ciphertext lives in `<userData>/credentials.bin`. If safeStorage is
// unavailable (e.g. headless Linux without a keyring), `set` returns
// false so the renderer can fall back to plaintext localStorage with
// a clear-eyed user prompt.
function credsPath(): string {
  return path.join(app.getPath('userData'), 'credentials.bin');
}

ipcMain.handle('creds:set', async (_evt, payload: unknown) => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  try {
    const json = JSON.stringify(payload);
    const enc = safeStorage.encryptString(json);
    await fsp.writeFile(credsPath(), enc, { mode: 0o600 });
    return true;
  } catch (err) {
    console.warn('creds:set failed', err);
    return false;
  }
});

ipcMain.handle('creds:get', async () => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = await fsp.readFile(credsPath());
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json);
  } catch (err) {
    // ENOENT is expected on first run; everything else is logged.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('creds:get failed', err);
    }
    return null;
  }
});

ipcMain.handle('creds:clear', async () => {
  try {
    await fsp.unlink(credsPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('creds:clear failed', err);
    }
  }
});

ipcMain.handle('creds:available', () => {
  return safeStorage.isEncryptionAvailable();
});

// Native main-process notification (more reliable on Windows than web Notification).
ipcMain.handle('show-notification', (_evt, opts: { title: string; body: string; icon?: string }) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({
    title: opts.title,
    body: opts.body,
    icon: opts.icon || path.join(__dirname, '../public/zulip_logo.png'),
    silent: false,
  });
  n.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  n.show();
  return true;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
