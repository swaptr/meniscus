import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import stylex from '@stylexjs/unplugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    // Must precede plugin-react. Generates src/routeTree.gen.ts and splits
    // each route's component into its own lazily-loaded chunk.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    stylex.vite({ useCSSLayers: true }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Meniscus',
        short_name: 'Meniscus',
        description: 'Bedside capture for hospital records',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
      },
    }),
  ],
  // Pre-bundle the Base UI components in use (imported per component) at
  // startup, so a lazy route or dialog doesn't trigger a mid-session
  // re-optimize and duplicate React. Add a component here when importing it.
  optimizeDeps: {
    include: [
      '@base-ui/react/alert-dialog',
      '@base-ui/react/button',
      '@base-ui/react/dialog',
      '@base-ui/react/drawer',
      '@base-ui/react/popover',
      '@base-ui/react/select',
      '@base-ui/react/switch',
      '@base-ui/react/toggle',
      '@base-ui/react/tooltip',
    ],
  },
  build: {
    rolldownOptions: {
      // Everything the first paint needs (React, the router, the shell) in
      // one chunk: every route loads all of it anyway, and one gzip stream
      // is ~5 KB smaller than the dozen small shared chunks it replaces.
      // Route and dialog chunks keep the default splitting.
      output: { codeSplitting: { groups: [{ name: 'app', tags: ['$initial'] }] } },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // The session cookie (Path=/api) passes through as is; it is the only credential.
      '/api': { target: 'http://127.0.0.1:8787' },
    },
  },
})
