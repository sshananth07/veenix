import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    pool: "forks",
    testTimeout: 20_000,
  },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
