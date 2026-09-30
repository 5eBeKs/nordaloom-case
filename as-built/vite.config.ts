import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // The email templates live with the server functions, which send them.
      "@emails": path.resolve(import.meta.dirname, "./supabase/functions/_shared/emails"),
    },
  },
  server: {
    // Scratch files (tooling caches, browser profiles) must not trigger reloads.
    watch: { ignored: ["**/.tmp/**", "**/supabase/**", "**/scripts/**"] },
  },
})
