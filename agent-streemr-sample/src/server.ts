// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @package @eetr/agent-streemr-sample
 *
 * Reference implementation of an agent-streemr server.
 *
 * Demonstrates how to wire @eetr/agent-streemr's `createAgentSocketListener`
 * with a real LangChain/LangGraph agent, local tools, and custom context.
 *
 * ## Architecture
 *
 * ```
 *  HTTP Server (express)
 *    └── Socket.io Server
 *          └── createAgentSocketListener
 *                ├── authenticate()       — verifies bearer token + installation_id
 *                ├── createContext()      — returns empty SampleContext per thread
 *                ├── getAgentRunner()     — returns streamAgentResponse()
 *                └── localToolRegistry   — sample local tools registered
 * ```
 *
 * @status SCAFFOLD — implementation pending
 */

// TODO: import createAgentSocketListener, LocalToolRegistry, createLocalTool from @eetr/agent-streemr
// TODO: import LangChain ChatOpenAI + createAgent + MemorySaver
// TODO: define SampleContext type
// TODO: create registry, register sample tools (get_prefs, notify)
// TODO: wire createAgentSocketListener with express + socket.io
// TODO: start HTTP server

export {};
