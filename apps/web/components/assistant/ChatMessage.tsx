"use client";
import { useState, useTransition } from "react";
import { ChevronDown, CircleCheck, Clock, Undo2 } from "lucide-react";
import type { AssistantMessageDto } from "@veenix/shared";
import { undoAssistantChange } from "@/actions/assistant";
import { cn } from "@/lib/utils";
import { ActionCard } from "./ActionCard";

const STEP_LABELS: Record<string, string> = {
  search_records: "Searched records",
  get_project: "Read the project",
  list_my_tasks: "Checked your tasks",
  query_records: "Looked up records",
  add_project_update: "Added a site update",
  create_task: "Created a task",
  set_project_stage: "Changed the stage",
  report_unsupported_request: "Noted a request it can't do yet",
};
const stepLabel = (name: string) => STEP_LABELS[name] ?? (name.startsWith("propose_") ? "Prepared an approval" : name.replaceAll("_", " "));

export function ChatMessage({ message, onChange }: { message: AssistantMessageDto; onChange: () => void }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto flex max-w-[85%] flex-col items-end gap-2">
        {message.photos.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.photos.map((p) => (
              <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived storage URLs */}
                <img src={p.url} alt={p.name} className="size-20 rounded-lg border object-cover" />
              </a>
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed">{message.text}</p>
      </div>
    );
  }
  return <AssistantReply message={message} onChange={onChange} />;
}

function AssistantReply({ message, onChange }: { message: AssistantMessageDto; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const hasSteps = message.steps.length > 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          Assistant
        </p>
        {(hasSteps || message.seconds != null) && (
          <button
            type="button"
            onClick={() => hasSteps && setOpen(!open)}
            aria-expanded={hasSteps ? open : undefined}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {hasSteps && <span>{message.steps.length} {message.steps.length === 1 ? "step" : "steps"}</span>}
            {message.seconds != null && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" aria-hidden />
                {message.seconds}s
              </span>
            )}
            {hasSteps && <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />}
          </button>
        )}
      </div>
      {open && (
        <ol className="space-y-1 border-l-2 pl-3 text-xs text-muted-foreground">
          {message.steps.map((s, i) => (
            <li key={i} className={cn(s.isError && "text-destructive")}>
              {stepLabel(s.name)}
              {s.isError && " (didn't work)"}
            </li>
          ))}
        </ol>
      )}
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
      {message.tables.map((t, i) => (
        <div key={i} className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-left">
              <tr>{t.columns.map((c) => <th key={c} className="px-2.5 py-1.5 font-medium">{c}</th>)}</tr>
            </thead>
            <tbody>
              {t.rows.map((r, j) => (
                <tr key={j} className="border-t">{r.map((cell, k) => <td key={k} className="px-2.5 py-1.5 tabular-nums">{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {message.changes.length > 0 && (
        <ul className="space-y-1.5">
          {message.changes.map((c) => <Change key={c.toolCallId} change={c} onChange={onChange} />)}
        </ul>
      )}
      {message.cards.map((card) => <ActionCard key={card.id} card={card} onDone={onChange} />)}
    </div>
  );
}

function Change({ change, onChange }: { change: AssistantMessageDto["changes"][number]; onChange: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="rounded-lg border bg-background px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <CircleCheck className={cn("size-4 shrink-0", change.undone ? "text-muted-foreground" : "text-emerald-600")} aria-hidden />
        <span className={cn("min-w-0 flex-1", change.undone && "text-muted-foreground line-through")}>{change.text}</span>
        {change.undone ? (
          <span className="text-xs text-muted-foreground">Undone</span>
        ) : (
          change.undoable && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await undoAssistantChange(change.toolCallId);
                  setError(r.ok ? null : r.error);
                  onChange();
                })
              }
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              <Undo2 className="size-3.5" aria-hidden /> Undo
            </button>
          )
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}
