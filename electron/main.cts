import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
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
// users self-host, so we constrain the dangerous knobs (script execution,
// frames, objects, base) and require https for outbound connects.
const CSP = [
  "default-src 'self'",
  // Vite's runtime + React DevTools need inline + eval in dev. In prod we
  // could tighten further; keeping inline for TipTap styles.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: ws://localhost:5173",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

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

  // CORS bypass for the Zulip API. We only rewrite headers for requests that
  // were initiated by the renderer's own webContents, so injected content
  // navigated into a third-party origin doesn't inherit the bypass.
  const ses = mainWindow.webContents.session;
  const ourWebContentsId = mainWindow.webContents.id;

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.webContentsId !== ourWebContentsId) {
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
    if (details.webContentsId === ourWebContentsId) {
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

// Focus the main window (used by notification click handlers).
ipcMain.handle('focus-window', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
