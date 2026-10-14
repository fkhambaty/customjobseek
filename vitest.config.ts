import { defineConfig } from "vitest/config";
import { resumeFontPlugins } from "./vite.plugins.ts";

export default defineConfig({
  plugins: resumeFontPlugins(),
  test: { include: ["tests/**/*.test.ts"], environment: "node", fileParallelism: false },
});
