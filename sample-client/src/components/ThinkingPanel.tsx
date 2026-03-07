import { useRef, useState } from "react";
import { useAgentStreamContext } from "@eetr/agent-streemr-react";

const MAX_TOKENS = 300;

function trimToWindow(text: string): string {
  const tokens = text.split(/(\s+)/);
  if (tokens.length <= MAX_TOKENS) return text;
  return "…" + tokens.slice(-MAX_TOKENS).join("");
}

export default function ThinkingPanel() {
  const { internalThought } = useAgentStreamContext();
  const [collapsed, setCollapsed] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);

  const display = trimToWindow(internalThought);
  const hasContent = display.trim().length > 0;

  return (
    <aside
      className={`flex flex-col bg-slate-800 border-l border-slate-700 shrink-0 transition-all duration-200 ${
        collapsed ? "w-8" : "w-72"
      }`}
    >
      {/* Toggle button */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-slate-400 hover:text-slate-200 border-b border-slate-700 shrink-0 select-none"
        title={collapsed ? "Expand thinking panel" : "Collapse thinking panel"}
      >
        {!collapsed && <span className="uppercase tracking-widest">Thinking</span>}
        <span className={`transition-transform ${collapsed ? "rotate-180" : ""}`}>
          {collapsed ? "›" : "‹"}
        </span>
      </button>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {hasContent ? (
            <pre
              ref={textRef}
              className="text-[0.7rem] leading-relaxed text-slate-400 font-mono whitespace-pre-wrap break-words"
            >
              {display}
            </pre>
          ) : (
            <p className="text-xs text-slate-500 italic text-center mt-4">
              Reasoning tokens will appear here while the agent thinks…
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
