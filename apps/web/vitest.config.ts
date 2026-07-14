import { defineConfig } from "vitest/config";
import { config } from "dotenv";
import path from "node:path";

config({ path: ".env.test" });

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@sot/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false, // suites share one test database
  },
});
