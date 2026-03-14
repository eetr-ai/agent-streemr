// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createAgent } from "langchain";
import { ChatOpenAI, tools as openAITools } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import type { AgentRunner, AgentStreamEvent } from "@eetr/agent-streemr";
import { buildLangChainConfig } from "@eetr/agent-streemr";
import { SYSTEM_PROMPT } from "./prompt.js";
import { type UserContext, buildContextualMessage } from "./userContext.js";
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
  recipeDelete,
  recipeSetPhoto,
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
    recipeDelete,
    recipeSetPhoto,
  ],
  checkpointer,
  systemPrompt: SYSTEM_PROMPT,
});

// ---------------------------------------------------------------------------
// AgentRunner — maps to the signature expected by createAgentSocketListener
// ---------------------------------------------------------------------------

export const streamAgentResponse: AgentRunner<UserContext> = async function* (
  message,
  options,
) {
  const { threadId, context, attachments } = options;
  console.log(`[stream] thread=${threadId} message="${message.slice(0, 80)}${message.length > 80 ? "..." : ""}"`)  

  const userContent = buildContextualMessage(message, context);
  if (userContent !== message) {
    console.log(`[stream] context injected for thread=${threadId}:`, JSON.stringify(context));
  }

  // Build message content — multimodal when image attachments are present.
  const imageAttachments = attachments?.filter((a) => a.type === "image") ?? [];
  let messageContent: string | Array<{ type: string; [k: string]: unknown }>;
  if (imageAttachments.length > 0) {
    messageContent = [
      { type: "text", text: userContent },
      ...imageAttachments.map((att) => ({
        type: "image_url" as const,
        image_url: { url: `data:image/jpeg;base64,${att.body}` },
      })),
    ];
    console.log(`[stream] ${imageAttachments.length} image attachment(s) included for thread=${threadId}`);
  } else {
    messageContent = userContent;
  }

  const tokenStream = await agent.stream(
    { messages: [{ role: "user", content: messageContent }] },
    {
      streamMode: "messages",
      configurable: buildLangChainConfig(options),
    },
  );

  let fullResponse = "";
  // Track announced tool call IDs so we emit each tool name only once.
  const announcedToolIds = new Set<string>();

  // Node names that produce model output — covers both LangGraph JS ("model_request")
  // and the Python-style convention ("model") used in the user's sample.
  const MODEL_NODES = new Set(["model_request", "model"]);

  for await (const [token, metadata] of tokenStream) {
    if (!MODEL_NODES.has(metadata.langgraph_node)) continue;

    // Announce server-side tool calls as internal tokens so the thinking panel
    // can show a "🔧 Calling: <name>…" status without touching the protocol.
    const toolCallChunks = (token as { tool_call_chunks?: Array<{ name?: string | null; id?: string | null }> }).tool_call_chunks;
    if (Array.isArray(toolCallChunks)) {
      for (const chunk of toolCallChunks) {
        if (!chunk.name) continue;
        const key = chunk.id ?? chunk.name;
        if (!announcedToolIds.has(key)) {
          announcedToolIds.add(key);
          yield { type: "internal_token", token: `\n🔧 Calling: ${chunk.name}…\n` } satisfies AgentStreamEvent;
        }
      }
    }

    let reasoningText = "";
    let responseText = "";

    if (Array.isArray(token.contentBlocks) && token.contentBlocks.length > 0) {
      for (const block of token.contentBlocks) {
        // "reasoning" blocks — stream to the thinking panel
        if (block.type === "reasoning" && block.thinking) {
          reasoningText += block.thinking;
        } else if (block.type === "text" && block.text) {
          responseText += block.text;
        }
      }
    // Fallback: plain string content
    } else if (typeof token.content === "string" && token.content) {
      responseText = token.content;
    }

    if (reasoningText) {
      yield { type: "internal_token", token: reasoningText } satisfies AgentStreamEvent;
    }

    if (responseText) {
      fullResponse += responseText;
      yield { type: "internal_token", token: responseText } satisfies AgentStreamEvent;
    }
  }

  yield { type: "agent_response", chunk: fullResponse, done: true } satisfies AgentStreamEvent;
};
