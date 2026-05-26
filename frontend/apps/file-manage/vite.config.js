import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import Components from 'unplugin-vue-components/vite';
import {PrimeVueResolver} from '@primevue/auto-import-resolver';

const normalizeBase = (value, fallback) => {
  const path = (value || fallback).replace(/\/+$/, "");
  return `${path || fallback}/`;
};

const appBase = normalizeBase(process.env.NGINX_FILE_MANAGE_PATH, "/manage");
const apiBase = (process.env.NGINX_API_PATH || "/api").replace(/\/+$/, "") || "/api";
const serverPort = Number(process.env.NGINX_FILE_MANAGE_PORT || 5173);
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT || 9000);

export default defineConfig({
  base: appBase,
  define: {
    __API_BASE__: JSON.stringify(apiBase)
  },
  plugins: [vue(),  Components({
      resolvers: [
        PrimeVueResolver()
      ]
    }), tailwindcss()],
  server: {
    host: true,
    port: serverPort,
    strictPort: true,
    hmr: {
      clientPort: hmrClientPort
    },
    watch: {
      usePolling: true
    }
  }
});
