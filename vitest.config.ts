import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: [
      "agent-streemr/src/**/*.test.ts",
      "agent-streemr/src/**/*.spec.ts",
      "agent-streemr-react/src/**/*.test.ts",
      "agent-streemr-react/src/**/*.spec.ts",
      "agent-streemr-sample/src/**/*.test.ts",
      "agent-streemr-sample/src/**/*.spec.ts",
    ],
    environment: "node",
  },
});
