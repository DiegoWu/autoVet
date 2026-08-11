import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {reporter: ["text", "html"]},
  },
  resolve: {
    alias: {"@": fileURLToPath(new URL("./src", import.meta.url))},
  },
});
