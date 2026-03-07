import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Forward Socket.io connections to the agent in dev so CORS isn't an issue
    proxy: {
      "/socket.io": {
        target: process.env.VITE_AGENT_URL ?? "http://localhost:8080",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
