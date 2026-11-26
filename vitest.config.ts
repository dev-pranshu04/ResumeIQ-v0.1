import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Opt-in slow simulations use *.spec.ts (not *.test.ts) specifically so this include
    // glob never picks them up automatically — see groq-client.simulation.slow.spec.ts's
    // own comment for why (real timers over tens of real seconds, on purpose). Run them
    // explicitly with `npm run test:simulation`.
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
