import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
    strictPort: true,
  },
  build: {
    rolldownOptions: {
      output: {
        // Vite 8 runs on Rolldown. `manualChunks` is deprecated there and only
        // supports the function form, so keep stable vendor groups with the
        // current `codeSplitting` API.
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
            },
            {
              name: 'query-vendor',
              test: /node_modules[\\/]@tanstack[\\/]/,
            },
            {
              name: 'charts-vendor',
              test: /node_modules[\\/](recharts|victory-vendor|d3-[^\\/]+|@reduxjs[\\/]toolkit|react-redux|reselect|immer|decimal\.js-light|es-toolkit|eventemitter3|tiny-invariant)[\\/]/,
            },
            {
              name: 'ui-vendor',
              test: /node_modules[\\/](radix-ui|@radix-ui|lucide-react|sonner|cmdk|class-variance-authority|clsx|tailwind-merge)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
