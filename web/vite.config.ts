import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    open: false,
    // API-Aufrufe an das lokale Backend weiterreichen (kein CORS-Aerger)
    // Ausdruecklich 127.0.0.1, nicht "localhost": Der Server lauscht bewusst
    // nur dort, und "localhost" kann unter Windows zuerst auf ::1 zeigen.
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
