// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createApp } from "./server.js";

export function bootstrap(): void {
  const port = Number(process.env.PORT ?? 8080);
  const { httpServer } = createApp();

  httpServer.listen(port, () => {
    console.log(`[agent-streemr-sample-agent] listening on http://localhost:${port}`);
    console.log(`[agent-streemr-sample-agent] health → http://localhost:${port}/health`);
  });
}
