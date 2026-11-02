"use client";
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { ArrowDown, ArrowUp, Bot, CornerDownRight, History, ImagePlus, Loader2, Search, SquarePen, Trash2, X } from "lucide-react";
import type { AssistantConversationDto, AssistantConversationListItemDto, AssistantMessageDto } from "@veenix/shared";
import { deleteAssistantConversation, getAssistantConversation, listAssistantConversations, sendAssistantMessage } from "@/actions/assistant";
import { uploadFile } from "@/lib/upload-client";
import { useLiveEvents } from "@/lib/useLiveEvents";
import { cn, formatDate } from "@/lib/utils";
import { ChatMessage } from "./ChatMessage";

const STORAGE_KEY = "veenix:assistant-open";
const Ctx = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({ open: false, setOpen: () => undefined });

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = useState(false);
  useEffect(() => setOpenState(localStorage.getItem(STORAGE_KEY) === "1"), []);
  const setOpen = useCallback((v: boolean) => {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    setOpenState(v);
  }, []);
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

export function AssistantToggle() {
  const { open, setOpen } = useContext(Ctx);
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors",
        open ? "border-primary/30 bg-primary/10 text-primary" : "bg-card hover:bg-muted",
      )}
    >
      <Bot className="size-4" aria-hidden />
      <span className="hidden sm:inline">AI Assistant</span>
    </button>
  );
}

const SUGGESTIONS = {
  project: ["Add a progress update to this project", "What tasks are open on this project?", "Summarise this project's procurement"],
  general: ["What are my tasks today?", "How many site updates were added this week?", "Which projects are in quoting?"],
};

const dayLabel = (d: Date) => {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : formatDate(d);
};

/** The assistant, docked on the right of every dashboard screen. Opened from a project, it resumes that project's latest chat. */
export function AssistantPanel() {
  // Mounted only while open, so a closed panel holds no live-events connection.
  return useContext(Ctx).open ? <PanelBody /> : null;
}

function PanelBody() {
  const { setOpen } = useContext(Ctx);
  const pathname = usePathname();
  const pageProject = pathname.match(/^\/projects\/([a-f\d]{24})/i)?.[1] ?? null;
  const [chatId, setChatId] = useState<string | null>(null); // null = a new chat
  const [conv, setConv] = useState<AssistantConversationDto | null>(null);
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [error, setError] = useState<string | null>(null);

  // On opening, and on moving to another project, pick up the latest chat for where the user is.
  useEffect(() => {
    let stale = false;
    setPicking(true);
    void listAssistantConversations("", pageProject).then((r) => {
      if (stale) return;
      setChatId(r.ok ? (r.data[0]?.id ?? null) : null);
      setPicking(false);
    });
    return () => {
      stale = true;
    };
  }, [pageProject]);

  const load = useCallback(async () => {
    if (!chatId) return setConv(null);
    const r = await getAssistantConversation(chatId);
    if (r.ok) {
      setConv(r.data);
      setError(null);
    } else setError(r.error);
  }, [chatId]);

  useEffect(() => {
    setConv(null);
    void load();
  }, [load]);
  useLiveEvents((e) => {
    if (e.kind === "assistant") void load();
  });
  // ponytail: a slow poll while busy covers a dropped live stream; remove if the stream proves reliable.
  const busy = !!conv?.busy;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [busy, load]);

  const iconButton = "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground";
  const title = view === "history" ? "Chat history" : chatId ? (conv?.title ?? "…") : "New chat";
  const subtitle = view === "chat" ? (conv?.projectName ?? (!chatId && pageProject ? "About this project" : null)) : null;
  return (
    <aside
      aria-label="AI Assistant"
      className="fixed inset-0 z-40 flex flex-col bg-card lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-[420px] lg:shrink-0 lg:border-l"
    >
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            setChatId(null);
            setView("chat");
          }}
          aria-label="New chat"
          title="New chat"
          className={iconButton}
        >
          <SquarePen className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setView(view === "history" ? "chat" : "history")}
          aria-label="Chat history"
          aria-pressed={view === "history"}
          title="Chat history"
          className={cn(iconButton, view === "history" && "bg-muted text-foreground")}
        >
          <History className="size-4" />
        </button>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant" className={iconButton}>
          <X className="size-4" />
        </button>
      </header>
      {view === "history" ? (
        <HistoryList
          current={chatId}
          onPick={(id) => {
            setChatId(id);
            setView("chat");
          }}
          onDeleted={(id) => {
            if (id === chatId) setChatId(null);
          }}
        />
      ) : (
        <>
          <Messages conv={picking || (chatId && !conv) ? null : conv} empty={!chatId && !picking} onChange={load} />
          <Composer
            key={chatId ?? `new:${pageProject}`}
            suggestions={pageProject ? SUGGESTIONS.project : SUGGESTIONS.general}
            busy={busy}
            error={error}
            onSend={async (text, photos) => {
              setError(null);
              const r = await sendAssistantMessage({ conversationId: chatId, projectId: chatId ? null : pageProject, text, photos });
              if (!r.ok) {
                setError(r.error);
                return false;
              }
              if (r.data.conversationId !== chatId) setChatId(r.data.conversationId);
              else await load();
              return true;
            }}
            onError={setError}
          />
        </>
      )}
    </aside>
  );
}

/** Every chat the user has had, newest first, with search and delete. */
function HistoryList({ current, onPick, onDeleted }: { current: string | null; onPick: (id: string) => void; onDeleted: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AssistantConversationListItemDto[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      const r = await listAssistantConversations(q.trim(), null);
      if (stale) return;
      if (r.ok) setRows(r.data);
      else setError(r.error);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);

  const remove = async (id: string) => {
    const r = await deleteAssistantConversation(id);
    if (!r.ok) return setError(r.error);
    setRows((list) => list?.filter((c) => c.id !== id) ?? null);
    setConfirming(null);
    onDeleted(id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3">
        <label className="flex items-center gap-2 rounded-lg border bg-background px-3 shadow-xs focus-within:ring-1 focus-within:ring-ring">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your chats"
            aria-label="Search your chats"
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {rows === null && (
          <li className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-label="Loading" />
          </li>
        )}
        {rows?.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">{q ? "No chats match that." : "No chats yet."}</li>}
        {rows?.map((c) => (
          <li key={c.id} className={cn("group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted", c.id === current && "bg-muted")}>
            {confirming === c.id ? (
              <>
                <span className="min-w-0 flex-1 truncate text-sm">Delete &ldquo;{c.title}&rdquo;?</span>
                <button type="button" onClick={() => void remove(c.id)} className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground">
                  Delete
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="rounded-md px-2 py-1 text-xs hover:bg-background">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => onPick(c.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{[c.projectName, dayLabel(c.lastMessageAt)].filter(Boolean).join(" · ")}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(c.id)}
                  aria-label={`Delete ${c.title}`}
                  className="rounded-md p-1.5 text-muted-foreground opacity-0 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Messages({ conv, empty, onChange }: { conv: AssistantConversationDto | null; empty: boolean; onChange: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const count = (conv?.messages.length ?? 0) + (conv?.busy ? 1 : 0);
  const toBottom = (smooth = true) => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });

  useEffect(() => {
    if (!away) toBottom(false);
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps -- follow new messages unless the user scrolled up

  if (!conv && !empty) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  let lastDay = "";
  const messages = conv?.messages ?? [];
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={(e) => setAway(e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight > 120)}
        className="h-full space-y-6 overflow-y-auto px-5 py-5"
        aria-live="polite"
      >
        {messages.length === 0 && !conv?.busy && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="size-5" aria-hidden />
            </span>
            <p className="text-sm font-semibold">Ask about your projects, or tell me what happened on site</p>
            <p className="text-xs text-muted-foreground">I can add updates, create tasks, change a stage and answer questions. Anything bigger comes to you as a card to approve.</p>
          </div>
        )}
        {messages.map((m: AssistantMessageDto) => {
          const day = dayLabel(m.createdAt);
          const sep = day !== lastDay;
          lastDay = day;
          return (
            <Fragment key={m.id}>
              {sep && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
                  <span className="h-px flex-1 bg-border" />
                  {day}
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <ChatMessage message={m} onChange={onChange} />
            </Fragment>
          );
        })}
        {conv?.busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Working on it…
          </p>
        )}
      </div>
      {away && (
        <button
          type="button"
          onClick={() => toBottom()}
          aria-label="Jump to latest"
          className="absolute bottom-3 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border bg-card shadow-md hover:bg-muted"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}

type Photo = { file: File; url: string };

function Composer({
  suggestions, busy, error, onSend, onError,
}: {
  suggestions: string[];
  busy: boolean;
  error: string | null;
  onSend: (text: string, photos: { key: string; name: string }[]) => Promise<boolean>;
  onError: (e: string) => void;
}) {
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [active, setActive] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const showSuggestions = focused && !hidden && text === "" && !sending;

  const send = async (value = text) => {
    const message = value.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      const uploaded = [];
      for (const p of photos) uploaded.push(await uploadFile(p.file, "photos"));
      if (await onSend(message, uploaded)) {
        setText("");
        setHidden(true);
        photos.forEach((p) => URL.revokeObjectURL(p.url));
        setPhotos([]);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (showSuggestions && e.key === "Escape") {
      setHidden(true);
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (showSuggestions) setText(suggestions[active]);
      else void send();
    }
  };

  return (
    <div className="shrink-0 space-y-2 p-3 pt-0">
      {showSuggestions && (
        <div className="rounded-xl border bg-card p-2 shadow-sm">
          <div className="flex items-center gap-1.5 px-2 pb-1.5 text-xs text-muted-foreground">
            <kbd className="rounded border bg-muted px-1">↑</kbd>
            <kbd className="rounded border bg-muted px-1">↓</kbd> navigate
            <kbd className="ml-2 rounded border bg-muted px-1.5">Enter</kbd> select
            <kbd className="ml-auto rounded border bg-muted px-1.5">Esc</kbd>
            <button type="button" aria-label="Hide suggestions" onMouseDown={(e) => e.preventDefault()} onClick={() => setHidden(true)} className="rounded p-0.5 hover:bg-muted">
              <X className="size-3.5" />
            </button>
          </div>
          <ul role="listbox" aria-label="Suggestions">
            {suggestions.map((s, i) => (
              <li key={s} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => setText(s)}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm", i === active && "bg-muted")}
                >
                  <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="px-1 text-sm text-destructive">{error}</p>}
      <div className="rounded-xl border bg-background shadow-xs focus-within:ring-1 focus-within:ring-ring">
        {photos.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {photos.map((p, i) => (
              <div key={p.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img src={p.url} alt={p.file.name} className="size-14 rounded-lg border object-cover" />
                <button
                  type="button"
                  aria-label={`Remove ${p.file.name}`}
                  onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 rounded-full border bg-card p-0.5 shadow-xs hover:bg-muted"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={busy ? "Ask a follow-up…" : "Ask anything, or tell me what happened"}
          aria-label="Message the assistant"
          className="field-sizing-content block max-h-40 min-h-11 w-full resize-none bg-transparent px-3.5 pt-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={photos.length >= 5}
            aria-label="Attach photos"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <ImagePlus className="size-4" />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])].slice(0, 5 - photos.length).map((file) => ({ file, url: URL.createObjectURL(file) }));
              setPhotos([...photos, ...picked]);
              e.target.value = "";
            }}
          />
          <span className="text-xs text-muted-foreground">Photos help with site updates</span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            aria-label="Send"
            className="ml-auto flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-40"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">The assistant can make mistakes. Check what it changes.</p>
    </div>
  );
}
