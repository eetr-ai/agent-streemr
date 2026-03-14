import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  useAgentStreamContext,
  type AgentMessage,
} from "@eetr/agent-streemr-react";
import type { Attachment } from "@eetr/agent-streemr-react";
import MessageBubble from "./MessageBubble";
import ThinkingPanel from "./ThinkingPanel";
import { ToolApprovalCard } from "./ToolApprovalCard";
import { useToolApproval } from "../context/ToolApprovalContext";
import { stagePhoto } from "../hooks/photoStaging";

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
  const { messages, sendMessage, connect, clearContext, status, isStreaming, isWorking, internalThought, error, socket, inactiveCloseReason } =
    useAgentStreamContext();

  const [input, setInput] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { pendingApprovals, approve, deny } = useToolApproval();

  // Scroll to bottom whenever messages change
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Holds a pending message to send after reconnection completes.
  const pendingSendRef = useRef<{ text: string; attachments?: Attachment[] } | null>(null);

  // When status transitions to "connected" and there's a pending send, fire it.
  useEffect(() => {
    if (status === "connected" && pendingSendRef.current) {
      const { text, attachments } = pendingSendRef.current;
      pendingSendRef.current = null;
      sendMessage(text, undefined, attachments);
    }
  }, [status, sendMessage]);

  const isDisconnected = status === "disconnected" || status === "error";
  const canSend = (status === "connected" && !isStreaming && !isWorking && input.trim().length > 0)
    || (isDisconnected && input.trim().length > 0);

  function reconnect() {
    try {
      const threadId = localStorage.getItem("agent_streemr_thread_id") ?? crypto.randomUUID();
      connect(threadId);
    } catch {
      // fallback
      connect(crypto.randomUUID());
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // dataUrl = "data:<mime>;base64,<data>"
      const base64 = dataUrl.split(",")[1];
      const mimeType = file.type || "image/jpeg";
      stagePhoto(base64, mimeType);
      setPendingAttachment({ base64, mimeType, name: file.name });
    };
    reader.readAsDataURL(file);
    // Reset the input so re-selecting the same file triggers onChange
    e.target.value = "";
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;

    // If disconnected, reconnect first — the message will be sent once connected.
    if (isDisconnected) {
      const text = input.trim();
      const att = pendingAttachment;
      const attachments: Attachment[] | undefined = att
        ? [{ type: "image", body: att.base64, name: att.name }]
        : undefined;
      pendingSendRef.current = { text, attachments };
      reconnect();
      setInput("");
      setPendingAttachment(null);
      return;
    }

    const attachments: Attachment[] | undefined = pendingAttachment
      ? [{ type: "image", body: pendingAttachment.base64, name: pendingAttachment.name }]
      : undefined;
    sendMessage(input.trim(), undefined, attachments);
    setInput("");
    setPendingAttachment(null);
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
        <div className="flex items-center gap-3">
          {isDisconnected && (
            <button
              onClick={reconnect}
              className="text-blue-400 hover:text-blue-300 transition-colors font-medium"
              title="Reconnect to agent"
            >
              Reconnect
            </button>
          )}
          <button
            onClick={clearContext}
            className="text-slate-400 hover:text-slate-200 transition-colors"
            title="Clear conversation"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Error / inactive-close banner */}
      {(error || inactiveCloseReason) && (
        <div className="px-4 py-2 bg-red-900/50 border-b border-red-700 text-xs text-red-300 flex items-center justify-between">
          <span>{inactiveCloseReason ? `Disconnected: ${inactiveCloseReason}` : error}</span>
          {isDisconnected && (
            <button
              onClick={reconnect}
              className="ml-3 text-blue-400 hover:text-blue-300 font-medium shrink-0"
            >
              Reconnect
            </button>
          )}
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
        {pendingApprovals.map((approval) => (
          <ToolApprovalCard
            key={approval.id}
            approval={approval}
            onApprove={(id, remember) => approve(id, remember)}
            onDeny={deny}
          />
        ))}
        <ThinkingPanel />
        {(isWorking || isStreaming) && !internalThought && (
          <div className="text-left">
            <div className="inline-flex items-center gap-1 rounded-2xl bg-slate-700 px-4 py-3">
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.32s]" />
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.16s]" />
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" />
            </div>
          </div>
        )}
      </div>

      {/* Attachment preview */}
      {pendingAttachment && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 border-t border-slate-700 shrink-0">
          <img
            src={`data:${pendingAttachment.mimeType};base64,${pendingAttachment.base64}`}
            alt="attachment preview"
            className="h-12 w-12 object-cover rounded-lg border border-slate-600"
          />
          <span className="text-xs text-slate-400 truncate flex-1">{pendingAttachment.name}</span>
          <button
            onClick={() => setPendingAttachment(null)}
            className="text-slate-500 hover:text-red-400 transition-colors text-xs"
          >
            Remove
          </button>
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 px-4 py-3 bg-slate-800 border-t border-slate-700 shrink-0"
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
        {/* Attach image button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={status !== "connected" || isStreaming || isWorking}
          className="shrink-0 text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors p-2"
          title="Attach image"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isDisconnected
              ? "Type a message… (Enter to reconnect & send)"
              : status === "connected"
                ? "Type a message… (Enter to send)"
                : "Connecting…"
          }
          disabled={status === "connecting" || isStreaming || isWorking}
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
