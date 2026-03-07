// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cors from "cors";
import {
  createAgentSocketListener,
  LocalToolRegistry,
} from "@eetr/agent-streemr";
import { streamAgentResponse } from "../agent/index.js";

// ---------------------------------------------------------------------------
// Context type — blank for this sample (no local tools, no per-thread state)
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type SampleContext = object;

// ---------------------------------------------------------------------------
// Shared registry — no tools registered; useLocalToolFallback on the client
// handles any stray tool calls automatically.
// ---------------------------------------------------------------------------
const localToolRegistry = new LocalToolRegistry<SampleContext>();

// ---------------------------------------------------------------------------
// Express + Socket.io setup
// ---------------------------------------------------------------------------

export function createApp() {
  const app = express();
  const httpServer = createServer(app);

  const clientOrigin = process.env.CLIENT_ORIGIN ?? "*";

  app.use(cors({ origin: clientOrigin }));
  app.use(express.json());

  // Simple health-check so the Docker container can be probed
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "agent-streemr-sample-agent" });
  });

  const io = new Server(httpServer, {
    cors: {
      origin: clientOrigin,
      methods: ["GET", "POST"],
    },
  });

  // -------------------------------------------------------------------------
  // Wire createAgentSocketListener
  // -------------------------------------------------------------------------
  createAgentSocketListener<SampleContext>({
    io,

    // No auth — just require a non-empty installation_id in the handshake.
    authenticate: (socket) => {
      const installationId = socket.handshake.auth?.installation_id;
      if (!installationId || typeof installationId !== "string") {
        return null; // rejects the connection
      }
      return { threadId: installationId };
    },

    // Empty context per thread.
    createContext: (_threadId): SampleContext => ({}),

    // Same runner for every thread — LangGraph manages per-thread memory
    // internally via MemorySaver keyed on configurable.thread_id.
    getAgentRunner: (_threadId) => streamAgentResponse,

    localToolRegistry,
  });

  return { app, httpServer };
}
