import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    __BUILD_ID__: JSON.stringify(process.env.VITE_BUILD_ID?.trim().slice(0, 12) || (command === 'serve' ? 'dev' : `local-${Date.now().toString(36)}`)),
  },
  plugins: [
    vue(),
    VitePWA({
      injectRegister: null,
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Watchtower',
        short_name: 'Watchtower',
        description: 'Log basketbalwedstrijden en statistieken met Watchtower.',
        lang: 'nl',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#f7f6f3',
        background_color: '#f7f6f3',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
}))
