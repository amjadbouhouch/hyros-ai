import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed port in dev (matches tauri.conf.json `devUrl`).
export default defineConfig({
    plugins: [react(), tailwindcss()],
    // Tauri uses a fixed port (1420); prevent Vite from picking another.
    server: {
        port: 1420,
        strictPort: true,
    },
    // Tauri needs relative paths in the built bundle.
    build: {
        target: "es2022",
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("@tanstack")) return "tanstack-query";
                },
            },
        },
    },
    envPrefix: ["VITE_", "TAURI_"],
});
