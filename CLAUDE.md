# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server only (renderer in browser at http://localhost:5173).
- `npm run electron:dev` — Vite + Electron together with hot reload (compiles `electron/*.cts` → `dist-electron/` then launches Electron).
- `npm run electron:compile` — TypeScript compile of just the Electron main/preload (`electron/tsconfig.json` → `dist-electron/`).
- `npm run build` — Vite build of the renderer to `dist/`.
- `npm run electron:preview` — Build renderer + compile electron + run Electron against the production build.
- `npm run electron:build` — Full electron-builder packaging; output lands in `release/` (NSIS Windows installer; see `build` block in `package.json`).

- `npm run typecheck` — type-checks the renderer (`tsconfig.json`) and the Electron main/preload. Vite does **not** type-check on build, so this is the only thing that catches type errors; run it before shipping.

There is no test runner, linter, or formatter wired up — `npm test` does not exist.

## Architecture

Two-process Electron app: a thin Electron shell (`electron/`) hosting a React 18 + Vite SPA (`src/`).

### Electron shell (`electron/`, written as `.cts` → `dist-electron/*.cjs`)
- `main.cts` creates a single `BrowserWindow`, points it at `http://localhost:5173` in dev or `dist/index.html` in prod, and **rewrites request/response headers to bypass CORS** so the renderer can call any Zulip server directly. Removing those `webRequest` handlers will break direct-API mode.
- `preload.cts` exposes `window.electronAPI` over `contextBridge` (`platform`, `isElectron`, `openExternal`, `focusWindow`, `showNotification`, `setServerUrl`, `creds`). **The app never touches this object directly** — it goes through `src/app/platform/` (below).
- External links are intercepted via `setWindowOpenHandler` and opened in the system browser.

### Platform boundary (`src/app/platform/`)
Everything shell-specific lives behind one interface (`types.ts`), so the rest of the app is host-agnostic and a Tauri port is a swap rather than a hunt:

- `index.ts` exports the singleton `platform`, chosen once at module load by `detectPlatform()`. Import it as `import { platform } from '../platform'`.
- `web.ts` (`WebPlatform`) is the plain-browser baseline: `window.open`, the web `Notification` API, global `fetch`, and Vite's `/zulip-api` proxy for all URLs.
- `electron.ts` (`ElectronPlatform`) extends `WebPlatform` and overrides only what IPC does better — external links, window focus, main-process notifications, `safeStorage` credentials, and direct-to-server URLs in packaged builds.

The interface covers: `openExternal`, `focusWindow`, `notify` / `requestNotificationPermission`, `fetch`, `setServerOrigin`, `apiBaseUrl`, `assetUrl`, and `secureCredentials`. **Do not reintroduce `window.electronAPI` lookups, `import.meta.env.DEV` URL branching, or bare `new Notification(...)` anywhere outside this directory** — that's exactly the coupling this module exists to remove. Adding a new shell means one new class plus one line in `detectPlatform()`.

### Renderer (`src/app/`)
Single-page React app rooted at `src/main.tsx` → `src/app/App.tsx`. State and the entire Zulip API surface live in **one big context provider**:

- `src/app/context/ZulipContext.tsx` (~30 KB) is the source of truth for `currentUser`, `users`, `subscriptions`, `topics`, `messages`, `presence`, `unreadCounts`, `dmConversations`, `realmEmoji`, etc. **Almost any new feature that touches server state should hook in here** rather than fetching from a component. It owns the long-poll **event loop** (`registerEventQueue` → `getEvents` in a while-loop) that maps Zulip events (`message`, `update_message`, `delete_message`, `reaction`, `presence`, `typing`, `update_message_flags`, `subscription`, …) into local state. Race conditions on rapid narrow switches are guarded by `currentNarrowRef` and a `navIdRef` pattern in `App.tsx`.
- `src/app/api/zulipApi.ts` is a thin class wrapping `platform.fetch` with Basic auth. Its base URL comes from `platform.apiBaseUrl(serverUrl)` — packaged Electron calls the server directly (relying on the CORS-bypass headers in `main.cts`), everything else goes through Vite's `/zulip-api` proxy (target set by `VITE_DEV_ZULIP_TARGET`, defaulting to `https://zulip.cyburity.com`). Never build a URL from `serverUrl` yourself; use `platform.apiBaseUrl` / `platform.assetUrl`.
- `src/app/api/types.ts` mirrors Zulip's REST/event payloads. Update it alongside any new endpoint.
- Components in `src/app/components/` are feature-level (`Sidebar`, `MessageList`, `RichComposer`, `MessageComposer`, `SearchBar`, `EmojiPicker`, `GifPicker`, `SettingsModal`, etc.) and consume the context via `useZulip()`. The `components/ui/` subtree is **shadcn/Radix primitives** (button, dialog, dropdown-menu, scroll-area, …) — prefer composing these over hand-rolling.
- `RichComposer` is the active TipTap-based composer; `MessageComposer` is a simpler legacy fallback. New composer features go in `RichComposer`. `App.tsx` resets it across narrow changes via a `key={...}` containing the active DM/topic.

### Styling & theming
- Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js`; configured in CSS).
- Themes are CSS variable-driven from `src/styles/theme.css` (light + `.dark` selector + extra named themes). The active theme is toggled by adding/removing `.dark` on `<html>` from `App.tsx`; the accent color is written to `--brand` / `--brand-hover` / `--brand-muted` CSS variables and persisted to `localStorage` (`zulipplus_theme`, `zulipplus_accent`). Use these variables in new components rather than hardcoding colors.

### Auth flow
`SignIn` collects `serverUrl + email + apiKey`, calls `login()` on the context, which constructs a `ZulipApi`, fetches `/users/me`, hydrates initial state, and starts the event loop. `login()` owns the `loading` flag in a `try`/`finally` — that flag gates the sign-in spinner, so leaking it on the failure path locks the user out of the form entirely.

Credentials go through `src/app/api/credentialStore.ts`, which prefers `platform.secureCredentials` (Electron `safeStorage`: Keychain / DPAPI / libsecret) and falls back to plaintext `localStorage` under `zulip_credentials` only in browser dev or when there's no keyring. It also migrates any leftover plaintext copy into the secure store on first load. UI prefs use a different prefix: `zulipplus_theme`, `zulipplus_accent`. (Inconsistent namespacing — pick one before refactoring.)

### Path alias
`@` → `src/` (configured in `vite.config.ts`).
