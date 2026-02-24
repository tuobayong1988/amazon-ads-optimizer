import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  plugins: [react()],
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
      "@db": path.resolve(templateRoot, "db"),
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./client/src/test/setup.ts"],
    include: [
      "client/**/*.{test,spec}.{ts,tsx}",
      "server/**/*.{test,spec}.ts",
    ],
    exclude: [
      "node_modules/**",
      "dist/**",
      "server/_archived_v149/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.config.ts",
        "**/*.d.ts",
        "**/test/**",
      ],
    },
  },
});
