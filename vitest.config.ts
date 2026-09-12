import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The "obsidian" package has no Node-resolvable entry (its members are
      // provided by Obsidian at runtime), so point tests at a small mock.
      obsidian: fileURLToPath(
        new URL("./src/test/mocks/obsidian.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});