/// <reference types="vite/client" />

// Injected by vite.config.ts `define` from package.json#version at build time.
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Pre-fills the sign-in form's server field. Optional. */
  readonly VITE_DEFAULT_ZULIP_SERVER?: string;
  /** Dev-only proxy target; consumed by vite.config.ts, not the app. */
  readonly VITE_DEV_ZULIP_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
