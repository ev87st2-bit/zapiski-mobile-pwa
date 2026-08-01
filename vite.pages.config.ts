import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/zapiski-mobile-pwa/",
  plugins: [react()],
  build: { outDir: "dist-pages" },
});
