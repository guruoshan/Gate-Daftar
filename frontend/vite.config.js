import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001';

// Extra website addresses allowed to reach this server, e.g. ALLOWED_HOSTS=gate.mycompany.com
const allowedHosts = [
  '.monkeycode-ai.live',
  ...String(process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
];

const proxy = {
  '/api': {
    target: apiTarget,
    changeOrigin: false,
    timeout: 0,
    proxyTimeout: 0,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts,
    proxy,
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts,
    proxy,
  },
});
