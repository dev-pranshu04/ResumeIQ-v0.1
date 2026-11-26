import { defineConfig } from "vitest/config";
import path from "node:path";

// Dedicated config for opt-in, slow simulation tests (*.slow.spec.ts) — see
// groq-client.simulation.slow.spec.ts's own comment for why these intentionally use real
// timers over tens of real seconds, and why they're kept out of the default `npm test`/CI
// run (vitest.config.ts) entirely rather than just skipped.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.slow.spec.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
