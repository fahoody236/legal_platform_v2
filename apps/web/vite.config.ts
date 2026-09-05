import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Overridable so a second API can be run alongside one already holding 3000.
// The default is unchanged.
const apiTarget = process.env["API_PROXY_TARGET"] ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Same-origin in development, so the session cookie is set and returned
      // without any cross-origin handling. The cookie is HttpOnly and
      // SameSite=Strict; routing the API under the same origin as the page is
      // what lets both attributes stay as strict as they are.
      "/api": {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
});
