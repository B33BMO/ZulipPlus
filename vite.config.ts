import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

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
