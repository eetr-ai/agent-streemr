import { useEffect, useRef } from "react";
import { AgentStreamProvider, useAgentStreamContext } from "@eetr/agent-streemr-react";
import ThinkingPanel from "./components/ThinkingPanel";
import ToolCallLog from "./components/ToolCallLog";
import ChatView from "./components/ChatView";

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
  const { connect, status, messages, isStreaming } = useAgentStreamContext();
  const prevMsgCountRef = useRef(0);

  // Connect once on mount
  useEffect(() => {
    connect(THREAD_ID);
  }, [connect]);

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
    <div className="flex h-screen overflow-hidden bg-slate-900 text-slate-100">
      {/* Main chat column */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center gap-3 px-5 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
          <span className="text-xl font-semibold tracking-tight">Agent Streemr</span>
          <span className="text-xs text-slate-400 font-mono bg-slate-700 px-2 py-0.5 rounded">
            sample
          </span>
        </header>

        {/* Chat + thinking */}
        <div className="flex flex-1 min-h-0">
          <ChatView />
          <ThinkingPanel />
        </div>
      </div>

      {/* Right sidebar — tool call log */}
      <ToolCallLog />
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
      <InnerApp />
    </AgentStreamProvider>
  );
}
