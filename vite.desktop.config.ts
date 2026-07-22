import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "electron/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, "desktop/index.html"),
    },
  },
});
