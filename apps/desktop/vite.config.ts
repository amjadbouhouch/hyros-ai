import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port in dev (matches tauri.conf.json `devUrl`).
export default defineConfig({
    plugins: [react()],
    // Tauri uses a fixed port (1420); prevent Vite from picking another.
    server: {
        port: 1420,
        strictPort: true,
    },
    // Tauri needs relative paths in the built bundle.
    build: {
        target: "es2022",
    },
    envPrefix: ["VITE_", "TAURI_"],
});