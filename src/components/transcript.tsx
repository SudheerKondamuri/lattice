"use client";
import type { Message } from "@/contracts/api";
import { EvidenceList } from "./evidence";
import { formatDate } from "@/lib/presentation";
export function Transcript({
  messages,
  inspect,
  inspectLabel,
  feedback,
  improve,
  busy = false,
}: {
  messages: Message[];
  inspect?: (sourceId: string, versionId: string) => void;
  inspectLabel?: string;
  feedback?: (message: Message, rating: "helpful" | "unhelpful") => void;
  improve?: (question: string, message: Message) => void;
  busy?: boolean;
}) {
  return (
    <div className="transcript">
      {messages.map((message, index) => (
        <article
          key={message.id}
          className={`chat-message message-${message.role}`}
        >
          <div className="message-body">
            <span className="message-label">
              {message.role === "user"
                ? "Visitor / question"
                : (message.disposition ?? "Assistant")}
            </span>
            <p>{message.content}</p>
            <small className="message-metadata">
              {formatDate(message.createdAt)} UTC
              {message.releaseId ? ` · release ${message.releaseId}` : ""}
            </small>
            {message.role === "assistant" && (
              <>
                <EvidenceList evidence={message.evidence} inspect={inspect} inspectLabel={inspectLabel}/>
                <div className="message-tools">
                  {feedback && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => feedback(message, "helpful")}
                      >
                        Helpful
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => feedback(message, "unhelpful")}
                      >
                        Not helpful
                      </button>
                    </>
                  )}
                  {improve && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        improve(
                          messages
                            .slice(0, index)
                            .reverse()
                            .find((m) => m.role === "user")?.content ?? "",
                          message,
                        )
                      }
                    >
                      Improve / save check
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
