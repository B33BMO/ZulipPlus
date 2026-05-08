import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import { readFileSync } from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// Inject package.json version into the bundle so the update banner can
// compare it against the latest GitHub Release tag at runtime.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))

// Dev-only proxy target. Set VITE_DEV_ZULIP_TARGET in a local .env to
// point at your own Zulip server during dev; production Electron talks
// to the configured server URL directly via the CORS-bypass shim in
// electron/main.cts and never hits this proxy.
const DEFAULT_DEV_TARGET = 'https://zulip.cyburity.com'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_DEV_ZULIP_TARGET || DEFAULT_DEV_TARGET
  return {
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used – do not remove them
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        // Alias @ to the src directory
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/zulip-api': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/zulip-api/, ''),
          secure: target.startsWith('https:'),
        },
      },
    },

    // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
    assetsInclude: ['**/*.svg', '**/*.csv'],
  }
})
