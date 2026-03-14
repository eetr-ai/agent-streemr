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
import type { UserContext } from "../agent/userContext.js";

// ---------------------------------------------------------------------------
// Max message/attachment size — shared between Socket.io transport and the
// agent-streemr protocol so the limits are aligned.
// ---------------------------------------------------------------------------
const MAX_MESSAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB

// ---------------------------------------------------------------------------
// Shared registry — no tools registered; useLocalToolFallback on the client
// handles any stray tool calls automatically.
// ---------------------------------------------------------------------------
const localToolRegistry = new LocalToolRegistry<UserContext>();

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
    maxHttpBufferSize: MAX_MESSAGE_SIZE_BYTES,
  });

  // -------------------------------------------------------------------------
  // Wire createAgentSocketListener
  // -------------------------------------------------------------------------
  createAgentSocketListener<UserContext>({
    io,

    // No auth — just require a non-empty installation_id in the handshake.
    authenticate: (socket) => {
      const installationId = socket.handshake.auth?.installation_id;
      if (!installationId || typeof installationId !== "string") {
        return null; // rejects the connection
      }
      return { threadId: installationId };
    },

    // Per-thread context — tracks selection state, etc.
    createContext: (_threadId): UserContext => ({}),

    // Same runner for every thread — LangGraph manages per-thread memory
    // internally via MemorySaver keyed on configurable.thread_id.
    getAgentRunner: (_threadId) => streamAgentResponse,

    localToolRegistry,

    // Merge client set_context payloads into the per-thread UserContext.
    onContextUpdate: (ctx, data) => {
      if ("selectedRecipeId" in data) {
        ctx.selectedRecipeId = data.selectedRecipeId as string | null;
      }
    },

    // Align the protocol-level max with the transport-level max.
    maxMessageSizeBytes: MAX_MESSAGE_SIZE_BYTES,

    // Server-wide inactivity timeout: 10 minutes.
    inactivityTimeoutMs: 10 * 60 * 1000,
  });

  return { app, httpServer };
}
