# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server only (renderer in browser at http://localhost:5173).
- `npm run electron:dev` — Vite + Electron together with hot reload (compiles `electron/*.cts` → `dist-electron/` then launches Electron).
- `npm run electron:compile` — TypeScript compile of just the Electron main/preload (`electron/tsconfig.json` → `dist-electron/`).
- `npm run build` — Vite build of the renderer to `dist/`.
- `npm run electron:preview` — Build renderer + compile electron + run Electron against the production build.
- `npm run electron:build` — Full electron-builder packaging; output lands in `release/` (NSIS Windows installer; see `build` block in `package.json`).

There is no test runner, linter, or formatter wired up — `npm test` does not exist. Type-check the Electron side with `npm run electron:compile`; the renderer is type-checked implicitly by Vite (no standalone `tsc` script).

## Architecture

Two-process Electron app: a thin Electron shell (`electron/`) hosting a React 18 + Vite SPA (`src/`).

### Electron shell (`electron/`, written as `.cts` → `dist-electron/*.cjs`)
- `main.cts` creates a single `BrowserWindow`, points it at `http://localhost:5173` in dev or `dist/index.html` in prod, and **rewrites request/response headers to bypass CORS** so the renderer can call any Zulip server directly. Removing those `webRequest` handlers will break direct-API mode.
- `preload.cts` exposes a minimal `window.electronAPI` (`platform`, `isElectron`, `openExternal`). The renderer detects Electron via `window.electronAPI?.isElectron`.
- External links are intercepted via `setWindowOpenHandler` and opened in the system browser.

### Renderer (`src/app/`)
Single-page React app rooted at `src/main.tsx` → `src/app/App.tsx`. State and the entire Zulip API surface live in **one big context provider**:

- `src/app/context/ZulipContext.tsx` (~30 KB) is the source of truth for `currentUser`, `users`, `subscriptions`, `topics`, `messages`, `presence`, `unreadCounts`, `dmConversations`, `realmEmoji`, etc. **Almost any new feature that touches server state should hook in here** rather than fetching from a component. It owns the long-poll **event loop** (`registerEventQueue` → `getEvents` in a while-loop) that maps Zulip events (`message`, `update_message`, `delete_message`, `reaction`, `presence`, `typing`, `update_message_flags`, `subscription`, …) into local state. Race conditions on rapid narrow switches are guarded by `currentNarrowRef` and a `navIdRef` pattern in `App.tsx`.
- `src/app/api/zulipApi.ts` is a thin class wrapping `fetch` with Basic auth. It picks its base URL based on environment:
  - **Production Electron** (`isElectron && !isDev`): direct calls to `${serverUrl}/api/v1` — relies on the CORS-bypass headers from `main.cts`.
  - **Dev or browser**: prefixes with `/zulip-api/api/v1`, which Vite rewrites via the proxy in `vite.config.ts` (currently hard-coded to `https://zulip.cyburity.com` — change there if pointing at another server during dev).
  - Any new endpoint must follow this same pattern; do not call `serverUrl` directly elsewhere.
- `src/app/api/types.ts` mirrors Zulip's REST/event payloads. Update it alongside any new endpoint.
- Components in `src/app/components/` are feature-level (`Sidebar`, `MessageList`, `RichComposer`, `MessageComposer`, `SearchBar`, `EmojiPicker`, `GifPicker`, `SettingsModal`, etc.) and consume the context via `useZulip()`. The `components/ui/` subtree is **shadcn/Radix primitives** (button, dialog, dropdown-menu, scroll-area, …) — prefer composing these over hand-rolling.
- `RichComposer` is the active TipTap-based composer; `MessageComposer` is a simpler legacy fallback. New composer features go in `RichComposer`. `App.tsx` resets it across narrow changes via a `key={...}` containing the active DM/topic.

### Styling & theming
- Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js`; configured in CSS).
- Themes are CSS variable-driven from `src/styles/theme.css` (light + `.dark` selector + extra named themes). The active theme is toggled by adding/removing `.dark` on `<html>` from `App.tsx`; the accent color is written to `--brand` / `--brand-hover` / `--brand-muted` CSS variables and persisted to `localStorage` (`zulipplus_theme`, `zulipplus_accent`). Use these variables in new components rather than hardcoding colors.

### Auth flow
`SignIn` collects `serverUrl + email + apiKey`, calls `login()` on the context, which constructs a `ZulipApi`, fetches `/users/me`, hydrates initial state, and starts the event loop. **Credentials are persisted in plaintext `localStorage` under `zulip_credentials`** (`ZulipContext.tsx`), and the provider auto-logs-in from that on mount. UI prefs use a different prefix: `zulipplus_theme`, `zulipplus_accent`. (Inconsistent namespacing — pick one before refactoring.)

### Path alias
`@` → `src/` (configured in `vite.config.ts`).
