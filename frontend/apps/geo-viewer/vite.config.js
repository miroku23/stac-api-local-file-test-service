import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";

const normalizeBase = (value, fallback) => {
  const path = (value || fallback).replace(/\/+$/, "");
  return `${path || fallback}/`;
};

const appBase = normalizeBase(process.env.NGINX_GEO_VIEWER_PATH, "/viewer");
const apiBase = (process.env.NGINX_API_PATH || "/api").replace(/\/+$/, "") || "/api";
const serverPort = Number(process.env.NGINX_GEO_VIEWER_PORT || 5174);
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT || 9000);
const dockerRepoRoot = fileURLToPath(new URL("../..", import.meta.url));
const localRepoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const repoRoot = existsSync(join(dockerRepoRoot, "wasm")) ? dockerRepoRoot : localRepoRoot;
const wasmReleaseDir = join(repoRoot, "wasm", "webgl-wasm", "target", "wasm32-unknown-unknown", "release");

export default defineConfig({
  base: appBase,
  define: {
    __API_BASE__: JSON.stringify(apiBase)
  },
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@webgl-wasm": wasmReleaseDir
    }
  },
  server: {
    host: true,
    port: serverPort,
    strictPort: true,
    hmr: {
      clientPort: hmrClientPort
    },
    watch: {
      usePolling: true
    },
    fs: {
      allow: [repoRoot]
    }
  }
});
