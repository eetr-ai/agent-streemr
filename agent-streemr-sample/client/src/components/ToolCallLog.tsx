import { useEffect, useRef, useState } from "react";
import { useAgentStreamContext } from "@eetr/agent-streemr-react";
import type { LocalToolPayload } from "@eetr/agent-streemr-react";
import { useToolApproval } from "../context/ToolApprovalContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatToolName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface LogEntry {
  id: string;
  ts: string;
  direction: "request" | "response";
  toolName: string;
  requestId: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ToolCallLog() {
  const { socket } = useAgentStreamContext();
  const { rememberedTools, forgetTool } = useToolApproval();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [allowListCollapsed, setAllowListCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socket) return;

    const onLocalTool = (data: LocalToolPayload) => {
      setLog((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          ts: new Date().toLocaleTimeString(),
          direction: "request",
          toolName: data.tool_name,
          requestId: data.request_id.slice(0, 8) + "…",
          detail: data.args_json ? JSON.stringify(data.args_json) : "—",
        },
      ]);
    };

    socket.on("local_tool", onLocalTool);
    return () => {
      socket.off("local_tool", onLocalTool);
    };
  }, [socket]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  return (
    <aside
      className={`flex flex-col bg-slate-800 border-l border-slate-700 shrink-0 transition-all duration-200 ${
        collapsed ? "w-8" : "w-72"
      }`}
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-slate-400 hover:text-slate-200 border-b border-slate-700 shrink-0 select-none"
        title={collapsed ? "Expand tool log" : "Collapse tool log"}
      >
        {!collapsed && <span className="uppercase tracking-widest">Tool Calls</span>}
        <span>{collapsed ? "‹" : "›"}</span>
      </button>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2 min-h-0 space-y-1.5">
          {log.length === 0 ? (
            <p className="text-xs text-slate-500 italic text-center mt-4 px-2">
              No tool calls yet. Tool requests from the agent will appear here.
            </p>
          ) : (
            log.map((entry) => (
              <div
                key={entry.id}
                className="rounded bg-slate-700 px-2.5 py-1.5 text-[0.68rem] leading-snug"
              >
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span
                    className={`font-semibold ${
                      entry.direction === "request" ? "text-amber-400" : "text-emerald-400"
                    }`}
                  >
                    {entry.direction === "request" ? "↓ request" : "↑ response"}
                  </span>
                  <span className="text-slate-500">{entry.ts}</span>
                </div>
                <div className="text-slate-300 font-mono">{entry.toolName}</div>
                <div className="text-slate-500 font-mono truncate" title={entry.detail}>
                  {entry.detail}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* ── Allowlist panel ─────────────────────────────────────── */}
      {!collapsed && (
        <div className="shrink-0 border-t border-slate-700">
          <button
            onClick={() => setAllowListCollapsed((c) => !c)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 select-none"
          >
            <span className="uppercase tracking-widest">Allowlist</span>
            <span>{allowListCollapsed ? "▸" : "▾"}</span>
          </button>

          {!allowListCollapsed && (
            <div className="max-h-40 overflow-y-auto p-2 space-y-1">
              {rememberedTools.length === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-2 px-1">
                  No remembered tools yet.
                </p>
              ) : (
                rememberedTools.map((toolName) => (
                  <div
                    key={toolName}
                    className="flex items-center justify-between rounded bg-slate-700/60 px-2.5 py-1.5"
                  >
                    <span className="text-[0.68rem] text-emerald-400 font-mono">
                      {formatToolName(toolName)}
                    </span>
                    <button
                      onClick={() => forgetTool(toolName)}
                      title="Remove from allowlist"
                      className="text-slate-500 hover:text-red-400 transition-colors text-xs leading-none pl-2"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
