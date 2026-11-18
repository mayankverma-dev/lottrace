import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env so we can read BACKEND_URL for the proxy target.
  // Note: BACKEND_URL has no VITE_ prefix so it's NOT exposed to the browser bundle.
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.BACKEND_URL || 'http://localhost:3000';

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'LotTrace Scanner',
          short_name: 'LotTrace',
          description: 'Scan barcodes and record supply chain events',
          theme_color: '#3b82f6',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/scan',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3002,
      strictPort: true,
      allowedHosts: true,
      // Proxy /api requests to the backend so cookies are same-origin.
      // This eliminates all cross-site cookie issues (sameSite restrictions,
      // CORS preflight on credentialed requests, etc.).
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          // Rewrite Set-Cookie domain so the browser stores it
          // against the scan-pwa's own origin (localhost or IP).
          cookieDomainRewrite: '',
        },
      },
    },
  };
});

