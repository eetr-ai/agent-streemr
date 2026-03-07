// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * ToolApprovalCard
 *
 * Renders inline in the message list for each pending tool invocation.
 * Shows the tool name, formatted arguments, and Allow / Deny buttons.
 */

import { useState } from "react";
import type { PendingApproval } from "../context/ToolApprovalContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Human-readable tool name: snake_case → Title Case words */
function formatToolName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Render args as a compact key: value list, skipping internal ids */
function ArgsList({ args }: { args: object }) {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {entries.map(([key, value]) => (
        <li key={key} className="flex gap-2 text-[0.7rem] font-mono">
          <span className="text-slate-400 shrink-0">{key}:</span>
          <span className="text-slate-300 break-all">
            {Array.isArray(value)
              ? value.length === 0
                ? "[]"
                : value.join(", ")
              : String(value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface ToolApprovalCardProps {
  approval: PendingApproval;
  onApprove: (id: string, remember: boolean) => void;
  onDeny: (id: string) => void;
}

export function ToolApprovalCard({ approval, onApprove, onDeny }: ToolApprovalCardProps) {
  const [remember, setRemember] = useState(false);

  return (
    <div className="flex justify-start">
      <div className="max-w-[82%] rounded-2xl rounded-bl-sm bg-slate-800 border border-slate-600/60 px-4 py-3 text-sm">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-widest text-amber-400">
            Tool Request
          </span>
        </div>

        {/* Tool name */}
        <p className="text-slate-200 font-medium">
          {formatToolName(approval.toolName)}
        </p>

        {/* Args */}
        <ArgsList args={approval.args} />

        {/* Remember checkbox */}
        <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="accent-emerald-500 w-3.5 h-3.5"
          />
          <span className="text-xs text-slate-400">Remember for this tool</span>
        </label>

        {/* Buttons */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => onApprove(approval.id, remember)}
            className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold py-1.5 transition-colors"
          >
            Allow
          </button>
          <button
            onClick={() => onDeny(approval.id)}
            className="flex-1 rounded-lg bg-slate-600 hover:bg-slate-500 active:bg-slate-700 text-white text-xs font-semibold py-1.5 transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
