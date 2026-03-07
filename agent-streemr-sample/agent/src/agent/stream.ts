// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage, AIMessageChunk } from "@langchain/core/messages";
import type { AgentRunner, AgentStreamEvent } from "@eetr/agent-streemr";
import { SYSTEM_PROMPT } from "./prompt.js";

// ---------------------------------------------------------------------------
// Shared model + memory (process-lifetime singletons)
// ---------------------------------------------------------------------------

const model = new ChatOpenAI({
  model: "gpt-4.1-mini",
  temperature: 0,
  streaming: true,
});

const checkpointer = new MemorySaver();

// Blank agent — no tools. LangGraph MemorySaver keeps conversation history
// per threadId via the configurable.thread_id key.
const agent = createAgent({
  model,
  tools: [],
  checkpointer,
  systemPrompt: SYSTEM_PROMPT,
});

// ---------------------------------------------------------------------------
// AgentRunner — maps to the signature expected by createAgentSocketListener
// ---------------------------------------------------------------------------

export const streamAgentResponse: AgentRunner<object> = async function* (message, { threadId }) {
  const eventStream = agent.streamEvents(
    { messages: [new HumanMessage(message)] },
    {
      version: "v2",
      configurable: { thread_id: threadId },
    },
  );

  for await (const event of eventStream) {
    if (event.event === "on_chat_model_stream") {
      const chunk = event.data?.chunk as AIMessageChunk | undefined;
      const content = chunk?.content;
      if (typeof content === "string" && content) {
        yield { type: "agent_response", chunk: content, done: false } satisfies AgentStreamEvent;
      }
    }
  }

  yield { type: "agent_response", done: true } satisfies AgentStreamEvent;
};
