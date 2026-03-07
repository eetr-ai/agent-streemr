// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createAgent } from "langchain";
import { ChatOpenAI, tools as openAITools } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import type { AgentRunner, AgentStreamEvent } from "@eetr/agent-streemr";
import { buildLangChainConfig } from "@eetr/agent-streemr";
import { SYSTEM_PROMPT } from "./prompt.js";
import {
  recipeList,
  recipeGetState,
  recipeCreate,
  recipeSetTitle,
  recipeSetDescription,
  recipeSetIngredients,
  recipeSetDirections,
  recipeSave,
  recipeLoad,
} from "./tools/index.js";

// ---------------------------------------------------------------------------
// Shared model + memory (process-lifetime singletons)
// ---------------------------------------------------------------------------

const model = new ChatOpenAI({
  model: "gpt-5-mini",
  streaming: true,
});

const checkpointer = new MemorySaver();

// Web search restricted to AllRecipes so the agent can look up recipe
// templates and ingredient combinations from a trusted culinary source.
const webSearch = openAITools.webSearch({
  filters: {
    allowedDomains: ["allrecipes.com"],
  },
});

const agent = createAgent({
  model,
  tools: [
    webSearch,
    recipeList,
    recipeGetState,
    recipeCreate,
    recipeSetTitle,
    recipeSetDescription,
    recipeSetIngredients,
    recipeSetDirections,
    recipeSave,
    recipeLoad,
  ],
  checkpointer,
  systemPrompt: SYSTEM_PROMPT,
});

// ---------------------------------------------------------------------------
// AgentRunner — maps to the signature expected by createAgentSocketListener
// ---------------------------------------------------------------------------

export const streamAgentResponse: AgentRunner<object> = async function* (
  message,
  options,
) {
  const { threadId } = options;
  console.log(`[stream] thread=${threadId} message="${message.slice(0, 80)}${message.length > 80 ? "..." : ""}"`)

  const tokenStream = await agent.stream(
    { messages: [{ role: "user", content: message }] },
    {
      streamMode: "messages",
      configurable: buildLangChainConfig(options),
    },
  );

  let tokenCount = 0;
  for await (const [token, metadata] of tokenStream) {
    // Only emit tokens from the model request node
    if (metadata.langgraph_node !== "model_request") continue;

    let text = "";

    // New API: normalized content blocks
    if (Array.isArray(token.contentBlocks) && token.contentBlocks.length > 0) {
      for (const block of token.contentBlocks) {
        if (block.type === "text" && block.text) text += block.text;
      }
    // Fallback: plain string content
    } else if (typeof token.content === "string" && token.content) {
      text = token.content;
    }

    if (text) {
      tokenCount++;
      console.log(`[stream] token #${tokenCount}: "${text.replace(/\n/g, "\\n")}"`);
      yield { type: "agent_response", chunk: text, done: false } satisfies AgentStreamEvent;
    }
  }

  console.log(`[stream] done — ${tokenCount} token(s) emitted for thread=${threadId}`);

  yield { type: "agent_response", done: true } satisfies AgentStreamEvent;
};
