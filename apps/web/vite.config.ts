import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // The generated SDK error module reads process.env.NODE_ENV. There is no
  // `process` in a browser, so substitute the literal at build time — in dev
  // too, since the workspace SDK is served as source, not a pre-bundled dep.
  define: { "process.env.NODE_ENV": JSON.stringify(mode) },
  server: {
    port: 5173,
    strictPort: true,
    // PreStocks does not expose browser CORS headers. Keep the dev preview
    // same-origin and read-only; production needs an equivalent server-side
    // proxy before this surface can be considered live there.
    proxy: {
      "/api/prestocks": {
        target: "https://prestocks.com",
        changeOrigin: true,
        rewrite: () => "/api/prestocks",
      },
    },
    // packages/domain is imported by relative path (it has no package.json);
    // allow Vite to serve files from the repo root.
    fs: { allow: ["../.."] },
  },
}));
