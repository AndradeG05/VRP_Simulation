import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: process.env.VRP_SIMULATION_API_TARGET ?? "http://127.0.0.1:8000", changeOrigin: true } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes("plotly.js-basic") ? "plotly" : undefined,
      },
    },
  },
});


