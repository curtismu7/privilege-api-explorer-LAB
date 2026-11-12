import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 7813); Vite on VITE_PORT (default 7815); /api is proxied.
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 7813}` };
export default defineConfig({
  plugins: [react()],
  // Relative base: the built app works from any URL prefix (e.g. behind the lab-proxy at /privilege-api-explorer/);
  // with the default "/" the module tag points at /assets/... outside the prefix and the proxy serves another lab's
  // SPA fallback there, which fails to parse and leaves a blank screen.
  base: "./",
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js" },
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 7815, strictPort: true, proxy: { "/api": api } },
});
