import { useEffect, useRef, useState } from "react";
import { AgentStreamProvider, useAgentStreamContext } from "@eetr/agent-streemr-react";
import ToolCallLog from "./components/ToolCallLog";
import ChatView from "./components/ChatView";
import RecipePanel from "./components/RecipePanel";
import ProtocolLog from "./components/ProtocolLog";
import { useRecipeTools } from "./hooks/useRecipeTools";
import { ToolApprovalProvider } from "./context/ToolApprovalContext";
import { RecipeProvider, useRecipeContext } from "./context/RecipeContext";

// ---------------------------------------------------------------------------
// Thread ID — persisted in localStorage so page refreshes keep conversation
// ---------------------------------------------------------------------------
function getOrCreateThreadId(): string {
  try {
    const stored = localStorage.getItem("agent_streemr_thread_id");
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem("agent_streemr_thread_id", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

const THREAD_ID = getOrCreateThreadId();

// Agent URL — set VITE_AGENT_URL in .env (defaults to localhost in dev with Vite proxy)
const AGENT_URL =
  (import.meta.env.VITE_AGENT_URL as string | undefined) ?? "http://localhost:5173";

// ---------------------------------------------------------------------------
// Inner app — needs to be inside AgentStreamProvider to call the context hook
// ---------------------------------------------------------------------------
function InnerApp() {
  const { connect, status, messages, isStreaming, socket, setContext } = useAgentStreamContext();
  const prevMsgCountRef = useRef(0);
  const [showProtocolLog, setShowProtocolLog] = useState(false);

  // Recipe selection state — owned by RecipeContext
  const { selectedId: activeRecipeId } = useRecipeContext();

  // Register all recipe local-tool handlers (+ non-recipe fallback)
  useRecipeTools(socket);

  // Connect once on mount
  useEffect(() => {
    connect(THREAD_ID);
  }, [connect]);

  // Keep the agent context in sync with the currently selected recipe
  useEffect(() => {
    setContext({ selectedRecipeId: activeRecipeId ?? null });
  }, [activeRecipeId, setContext]);

  // Log connection status changes
  useEffect(() => {
    console.log(`[agent-streemr] status →`, status);
  }, [status]);

  // Log each new/updated message
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (messages.length > prevMsgCountRef.current) {
      prevMsgCountRef.current = messages.length;
      console.log(`[agent-streemr] new message (${last.role}, streaming=${last.streaming}):`, JSON.stringify(last.content.slice(0, 120)));
    } else if (last.streaming) {
      console.log(`[agent-streemr] chunk received — content so far: ${last.content.length} chars`);
    } else {
      console.log(`[agent-streemr] message finalised (${last.role}), length=${last.content.length}`);
    }
  }, [messages]);

  // Log streaming state changes
  useEffect(() => {
    console.log(`[agent-streemr] isStreaming →`, isStreaming);
  }, [isStreaming]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-900 text-slate-100">
      {/* Full-width header */}
      <header className="flex items-center gap-3 px-5 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
        <span className="text-xl font-semibold tracking-tight">Agent Streemr</span>
        <span className="text-xs text-slate-400 font-mono bg-slate-700 px-2 py-0.5 rounded">
          sample
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setShowProtocolLog((v) => !v)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded border transition-colors ${
            showProtocolLog
              ? "border-blue-500 text-blue-400 bg-blue-950/40 hover:bg-blue-950/60"
              : "border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500"
          }`}
          title="Toggle Protocol Log"
        >
          <span className="font-mono">{showProtocolLog ? "▾" : "▸"}</span>
          Protocol Log
        </button>
      </header>

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left half — recipe editor */}
        <div className="flex w-1/2 min-h-0 overflow-hidden bg-slate-950">
          <RecipePanel />
        </div>

        {/* Divider */}
        <div className="w-0.5 shrink-0 bg-slate-600 shadow-[1px_0_6px_rgba(148,163,184,0.15)]" />

        {/* Right half — chat + tool call log */}
        <div className="flex w-1/2 min-h-0 overflow-hidden bg-slate-900">
          <ChatView />
          <ToolCallLog />
        </div>
      </div>

      {/* Protocol Log — collapsible bottom panel */}
      <ProtocolLog open={showProtocolLog} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root export — wraps with provider
// ---------------------------------------------------------------------------
export default function App() {
  return (
    // token is empty string — the sample agent does not validate tokens
    <AgentStreamProvider url={AGENT_URL} token="">
      <ToolApprovalProvider>
        <RecipeProvider>
          <InnerApp />
        </RecipeProvider>
      </ToolApprovalProvider>
    </AgentStreamProvider>
  );
}
