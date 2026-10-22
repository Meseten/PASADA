import { defineConfig, configDefaults } from "vitest/config"
import path from "path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  // React JSX in component tests (the app pages are .tsx).
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    // e2e/ holds Playwright specs run by `npx playwright test`, not vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
