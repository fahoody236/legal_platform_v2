import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Same-origin in development, so the session cookie is set and returned
      // without any cross-origin handling. The cookie is HttpOnly and
      // SameSite=Strict; routing the API under the same origin as the page is
      // what lets both attributes stay as strict as they are.
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: false,
      },
    },
  },
});
