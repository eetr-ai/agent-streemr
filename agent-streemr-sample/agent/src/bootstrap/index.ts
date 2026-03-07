// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import "dotenv/config";
import { createApp } from "./server.js";

export function bootstrap(): void {
  const port = Number(process.env.PORT ?? 8080);

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[agent-streemr-sample-agent] ⚠️  OPENAI_API_KEY is not set — requests will fail");
  }

  const { httpServer } = createApp();

  httpServer.listen(port, () => {
    console.log("┌─────────────────────────────────────────┐");
    console.log("│      agent-streemr-sample-agent         │");
    console.log("└─────────────────────────────────────────┘");
    console.log(`  HTTP  → http://localhost:${port}`);
    console.log(`  WS    → ws://localhost:${port}/socket.io`);
    console.log(`  Health→ http://localhost:${port}/health`);
    console.log();
  });
}

bootstrap();
