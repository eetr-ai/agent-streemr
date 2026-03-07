import { useEffect, useRef, useState, useCallback } from "react";
import { useAgentStreamContext } from "@eetr/agent-streemr-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ProtocolEntry {
  id: string;
  ts: string;
  direction: "outgoing" | "incoming";
  event: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payloads: any[];
  expanded: boolean;
  /** How many consecutive identical events were merged into this entry. */
  count: number;
}

// ---------------------------------------------------------------------------
// Event metadata — colours and descriptions for each protocol event
// ---------------------------------------------------------------------------
const EVENT_META: Record<string, { color: string; label: string }> = {
  // Client → Server
  message:             { color: "text-blue-400",   label: "Send message" },
  local_tool_response: { color: "text-blue-300",   label: "Tool response" },
  clear_context:       { color: "text-sky-400",    label: "Clear context" },
  set_context:         { color: "text-sky-300",    label: "Set context" },
  // Server → Client
  internal_token:      { color: "text-violet-400", label: "Thinking token" },
  local_tool:          { color: "text-amber-400",  label: "Tool request" },
  agent_response:      { color: "text-emerald-400",label: "Agent response" },
  context_cleared:     { color: "text-teal-400",   label: "Context cleared" },
  error:               { color: "text-red-400",    label: "Error" },
};

function meta(event: string) {
  return EVENT_META[event] ?? { color: "text-slate-400", label: event };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return "—";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function summarisePayload(event: string, payload: unknown): string {
  if (payload === null || payload === undefined) return "—";
  // Truncate streaming tokens to keep the log readable
  if (event === "internal_token" && typeof payload === "object" && payload !== null) {
    const t = (payload as Record<string, unknown>).token;
    if (typeof t === "string") {
      return `"${t.length > 60 ? t.slice(0, 60) + "…" : t}"`;
    }
  }
  if (event === "agent_response" && typeof payload === "object" && payload !== null) {
    const p = payload as Record<string, unknown>;
    const chunk = typeof p.chunk === "string" ? p.chunk : "";
    const done = p.done ? " ✓ done" : "";
    return chunk.length > 60 ? `"${chunk.slice(0, 60)}…"${done}` : `"${chunk}"${done}`;
  }
  const s = JSON.stringify(payload);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

// ---------------------------------------------------------------------------
// Single entry row
// ---------------------------------------------------------------------------
function EntryRow({ entry, onToggle }: { entry: ProtocolEntry; onToggle: (id: string) => void }) {
  const { color, label } = meta(entry.event);
  const isIncoming = entry.direction === "incoming";

  return (
    <div
      className={`rounded border text-[0.7rem] font-mono leading-snug cursor-pointer select-none transition-colors ${
        isIncoming
          ? "border-slate-600 bg-slate-800/60 hover:bg-slate-800"
          : "border-slate-700/60 bg-slate-900/60 hover:bg-slate-900"
      }`}
      onClick={() => onToggle(entry.id)}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {/* Direction arrow */}
        <span
          className={`shrink-0 font-bold text-[0.65rem] ${
            isIncoming ? "text-emerald-500" : "text-blue-500"
          }`}
          title={isIncoming ? "Server → Client" : "Client → Server"}
        >
          {isIncoming ? "S→C" : "C→S"}
        </span>

        {/* Event name */}
        <span className={`font-semibold ${color}`}>{entry.event}</span>

        {/* Description */}
        <span className="text-slate-500 truncate flex-1">{label}</span>

        {/* Count pill */}
        {entry.count > 1 && (
          <span className="shrink-0 bg-slate-600 text-slate-300 text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full tabular-nums">
            ×{entry.count}
          </span>
        )}

        {/* Timestamp */}
        <span className="text-slate-600 shrink-0 tabular-nums">{entry.ts}</span>

        {/* Expand indicator */}
        <span className="text-slate-600 shrink-0">{entry.expanded ? "▾" : "▸"}</span>
      </div>

      {/* Summary line */}
      {!entry.expanded && (
        <div className="px-2.5 pb-1.5 text-slate-500 truncate">
          {summarisePayload(entry.event, entry.payloads[entry.payloads.length - 1])}
        </div>
      )}

      {/* Expanded payloads */}
      {entry.expanded && (
        <div className="border-t border-slate-700/50 mt-0.5 max-h-64 overflow-y-auto">
          {entry.payloads.map((p, i) => (
            <div key={i} className="border-b border-slate-700/30 last:border-b-0">
              {entry.count > 1 && (
                <div className="px-2.5 pt-1.5 text-[0.6rem] text-slate-600 select-none">
                  #{i + 1}
                </div>
              )}
              <pre className="px-2.5 py-1.5 text-slate-300 whitespace-pre-wrap break-all overflow-x-auto">
                {formatPayload(p)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface ProtocolLogProps {
  open: boolean;
}

export default function ProtocolLog({ open }: ProtocolLogProps) {
  const { socket } = useAgentStreamContext();
  const [entries, setEntries] = useState<ProtocolEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Build a timestamp string with ms precision
  const now = () =>
    new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const addEntry = useCallback(
    (direction: ProtocolEntry["direction"], event: string, args: unknown[]) => {
      const payload = args.length === 0 ? null : args.length === 1 ? args[0] : args;
      setEntries((prev) => {
        const last = prev[prev.length - 1];
        // Merge consecutive events of the same type and direction
        if (last && last.event === event && last.direction === direction) {
          return [
            ...prev.slice(0, -1),
            { ...last, count: last.count + 1, ts: now(), payloads: [...last.payloads, payload] },
          ];
        }
        return [
          ...prev,
          { id: crypto.randomUUID(), ts: now(), direction, event, payloads: [payload], expanded: false, count: 1 },
        ];
      });
    },
    [],
  );

  // Attach socket listeners
  useEffect(() => {
    if (!socket) return;

    const onIncoming = (event: string, ...args: unknown[]) =>
      addEntry("incoming", event, args);
    const onOutgoing = (event: string, ...args: unknown[]) =>
      addEntry("outgoing", event, args);

    socket.onAny(onIncoming);
    socket.onAnyOutgoing(onOutgoing);

    return () => {
      socket.offAny(onIncoming);
      socket.offAnyOutgoing(onOutgoing);
    };
  }, [socket, addEntry]);

  // Auto-scroll when panel is open
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries, open]);

  const toggleExpanded = useCallback((id: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, expanded: !e.expanded } : e)),
    );
  }, []);

  if (!open) return null;

  return (
    <div className="flex flex-col h-64 shrink-0 border-t border-slate-600 bg-slate-950">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Protocol Log
          </span>
          <span className="flex items-center gap-1.5 text-[0.65rem] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="font-bold text-blue-500">C→S</span> client to server
            </span>
            <span className="text-slate-700">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="font-bold text-emerald-500">S→C</span> server to client
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[0.65rem] text-slate-600 tabular-nums">
            {entries.reduce((n, e) => n + e.count, 0)} events
          </span>
          <button
            onClick={() => setEntries([])}
            className="text-[0.65rem] text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-wider"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
        {entries.length === 0 ? (
          <p className="text-xs text-slate-600 italic text-center mt-6">
            No protocol events yet — send a message to see the socket events flow.
          </p>
        ) : (
          entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onToggle={toggleExpanded} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
