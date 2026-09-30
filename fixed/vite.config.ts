import { createHash } from "node:crypto"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

/**
 * Gives the service worker (public/sw.js) this build's version and its list
 * of files. The version comes from the built page, which names the build's
 * script and styles, so every build that changes anything is a new version:
 * phones with the shop installed then notice it, save the new files, drop the
 * old ones and offer to refresh.
 */
function serviceWorkerVersion(): Plugin {
  let outDir = ""
  return {
    name: "nordaloom-service-worker-version",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const file = path.join(outDir, "sw.js")
      const version = createHash("sha256").update(readFileSync(path.join(outDir, "index.html"))).digest("hex").slice(0, 12)
      const files = readdirSync(path.join(outDir, "assets")).sort().map((name) => `/assets/${name}`)
      const source = readFileSync(file, "utf8")
      const stamped = source.replace('const VERSION = "dev"', `const VERSION = ${JSON.stringify(version)}`).replace("const BUILD_FILES = []", `const BUILD_FILES = ${JSON.stringify(files)}`)
      if (stamped === source || !stamped.includes(version) || !stamped.includes(files[0])) throw new Error("public/sw.js no longer has the VERSION and BUILD_FILES lines the build fills in")
      writeFileSync(file, stamped)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorkerVersion()],
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
