import { marked } from "marked";
import DOMPurify from "dompurify";
import type { AgentMessage } from "@eetr/agent-streemr-react";

// Configure marked once
marked.setOptions({ breaks: true });

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

interface Props {
  message: AgentMessage;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[82%] bg-slate-700 text-slate-100 px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed">
        {message.content ? (
          <div
            className="chat-markdown"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        ) : (
          /* streaming placeholder */
          <span className="inline-flex gap-1 items-center text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
          </span>
        )}
        {message.streaming && message.content && (
          <span className="inline-block w-0.5 h-3.5 bg-blue-400 ml-0.5 align-middle animate-pulse" />
        )}
      </div>
    </div>
  );
}
