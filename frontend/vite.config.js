import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001';

const proxy = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
    timeout: 0,
    proxyTimeout: 0,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['.monkeycode-ai.live'],
    proxy,
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: ['.monkeycode-ai.live'],
    proxy,
  },
});
