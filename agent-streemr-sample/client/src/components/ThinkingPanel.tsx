import { useRef } from "react";
import { useAgentStreamContext } from "@eetr/agent-streemr-react";

const THINKING_WINDOW_TOKENS = 300;

function trimToWindow(text: string): string {
  const tokens = text.split(/(\s+)/);
  if (tokens.length <= THINKING_WINDOW_TOKENS) return text;
  return "…" + tokens.slice(-THINKING_WINDOW_TOKENS).join("");
}

/**
 * Inline thinking card — renders inside the message list while the agent is
 * streaming internal reasoning tokens.  Returns null when there is nothing to
 * show so it takes up no space between messages.
 *
 * Mirrors the thinking block in chat.html (progression-ai reference):
 *  - spinning brain SVG on the left
 *  - "Thinking" label in muted xs uppercase
 *  - monospace token text in a max-h-24 scrollable container
 *  - dark card: bg-slate-800/80 border border-slate-600/50
 */
export default function ThinkingPanel() {
  const { internalThought } = useAgentStreamContext();
  const textRef = useRef<HTMLParagraphElement>(null);

  const display = trimToWindow(internalThought ?? "");
  const hasContent = display.trim().length > 0;

  if (!hasContent) return null;

  return (
    <div className="text-left">
      <div className="flex gap-3 items-start rounded-lg bg-slate-800/80 border border-slate-600/50 p-3 min-h-[4rem]">
        {/* Spinning brain icon */}
        <span className="flex-shrink-0 mt-0.5 text-slate-400 animate-spin" aria-hidden>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
          </svg>
        </span>

        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">
            Thinking
          </p>
          <p
            ref={textRef}
            className="text-slate-300 text-sm whitespace-pre-wrap break-words font-mono max-h-24 overflow-y-auto"
            tabIndex={0}
          >
            {display || "…"}
          </p>
        </div>
      </div>
    </div>
  );
}
