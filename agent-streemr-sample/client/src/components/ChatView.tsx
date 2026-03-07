import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  useAgentStreamContext,
  useLocalToolFallback,
  type AgentMessage,
} from "@eetr/agent-streemr-react";
import MessageBubble from "./MessageBubble";
import ThinkingPanel from "./ThinkingPanel";

// ---------------------------------------------------------------------------
// Connection status badge
// ---------------------------------------------------------------------------
function StatusBadge() {
  const { status } = useAgentStreamContext();

  const map: Record<string, { label: string; color: string }> = {
    connected: { label: "connected", color: "bg-emerald-500" },
    connecting: { label: "connecting…", color: "bg-yellow-500 animate-pulse" },
    disconnected: { label: "disconnected", color: "bg-slate-500" },
    error: { label: "error", color: "bg-red-500" },
  };

  const { label, color } = map[status] ?? map.disconnected;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main chat view
// ---------------------------------------------------------------------------
export default function ChatView() {
  const { messages, sendMessage, clearContext, status, isStreaming, error, socket } =
    useAgentStreamContext();

  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-reply notSupported for any tool call the agent might send (blank agent
  // has no tools, but this future-proofs the sample).
  useLocalToolFallback(socket);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const canSend = status === "connected" && !isStreaming && input.trim().length > 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    sendMessage(input.trim());
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-850 border-b border-slate-700 text-xs shrink-0 bg-slate-900">
        <StatusBadge />
        <button
          onClick={clearContext}
          className="text-slate-400 hover:text-slate-200 transition-colors"
          title="Clear conversation"
        >
          Clear
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-900/50 border-b border-red-700 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Messages */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-500 text-sm text-center max-w-xs">
              Say hello! This is a sample blank agent powered by{" "}
              <span className="text-slate-400 font-mono">@eetr/agent-streemr</span>.
            </p>
          </div>
        )}
        {messages.map((msg: AgentMessage) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <ThinkingPanel />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 px-4 py-3 bg-slate-800 border-t border-slate-700 shrink-0"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            status === "connected" ? "Type a message… (Enter to send)" : "Connecting…"
          }
          disabled={status !== "connected" || isStreaming}
          rows={1}
          className="flex-1 bg-slate-700 text-slate-100 placeholder-slate-400 rounded-xl px-4 py-2.5 text-sm resize-none outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 leading-relaxed max-h-40 overflow-auto"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          type="submit"
          disabled={!canSend}
          className="shrink-0 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
