import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        /** 127.0.0.1 avoids Windows localhost → ::1 vs IPv4-only listen mismatches. */
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
  /** Same proxy as `vite dev` — `vite preview` otherwise returns SPA HTML for `/api/*` (404). */
  preview: {
    port: 4173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
