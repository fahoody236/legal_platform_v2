import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { Hash, MessageSquare, Send, Plus, Loader2, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isToday, isYesterday } from 'date-fns';

// ── Types ──────────────────────────────────────────────────────────

interface Channel {
  id: number;
  name: string;
  description?: string | null;
  type: string;
  caseId?: number | null;
  caseName?: string | null;
  createdAt: string;
}

interface Message {
  id: number;
  channelId: number;
  senderId?: number | null;
  senderName: string;
  content: string;
  createdAt: string;
}

// ── API helpers ────────────────────────────────────────────────────

async function fetchChannels(): Promise<Channel[]> {
  const r = await fetch("/api/chat/channels");
  if (!r.ok) throw new Error("Failed to fetch channels");
  return r.json();
}

async function fetchMessages(channelId: number): Promise<Message[]> {
  const r = await fetch(`/api/chat/channels/${channelId}/messages?limit=80`);
  if (!r.ok) throw new Error("Failed to fetch messages");
  return r.json();
}

async function sendMessage(channelId: number, content: string, senderId?: number): Promise<Message> {
  const r = await fetch(`/api/chat/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, senderId }),
  });
  if (!r.ok) throw new Error("Failed to send message");
  return r.json();
}

async function createChannel(body: { name: string; description?: string; type: string; caseId?: number; createdById?: number }): Promise<Channel> {
  const r = await fetch("/api/chat/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Failed to create channel");
  return r.json();
}

// ── Timestamp helper ───────────────────────────────────────────────

function formatTs(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return `Yesterday ${format(d, "HH:mm")}`;
  return format(d, "d MMM, HH:mm");
}

// ── Message bubble ─────────────────────────────────────────────────

function MessageBubble({ msg, prevSenderId }: { msg: Message; prevSenderId?: number | null }) {
  const isFirstInGroup = prevSenderId !== msg.senderId;
  const initials = msg.senderName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className={cn("flex gap-3 group px-4", isFirstInGroup ? "mt-4" : "mt-0.5")}>
      <div className="w-8 shrink-0">
        {isFirstInGroup && (
          <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold font-serif select-none">
            {initials}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {isFirstInGroup && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-sm font-semibold text-foreground">{msg.senderName}</span>
            <span className="text-xs text-muted-foreground font-mono">{formatTs(msg.createdAt)}</span>
          </div>
        )}
        <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
      </div>
    </div>
  );
}

// ── New channel modal ──────────────────────────────────────────────

function NewChannelModal({ onClose, onCreated, userId }: { onClose: () => void; onCreated: (c: Channel) => void; userId?: number }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const c = await createChannel({ name: name.trim(), description: desc.trim() || undefined, type: "general", createdById: userId });
      onCreated(c);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="font-serif text-xl font-semibold mb-4">Create Channel</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Channel Name</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. case-updates"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Description (optional)</label>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="What's this channel for?"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors">Cancel</button>
            <button type="submit" disabled={loading || !name.trim()} className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {loading ? "Creating…" : "Create Channel"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Chat page ─────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [showModal, setShowModal] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: channels = [], isLoading: loadingChannels } = useQuery({
    queryKey: ["chat-channels"],
    queryFn: fetchChannels,
    refetchOnWindowFocus: false,
  });

  // Auto-select first channel
  useEffect(() => {
    if (channels.length > 0 && activeChannelId === null) {
      setActiveChannelId(channels[0].id);
    }
  }, [channels, activeChannelId]);

  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ["chat-messages", activeChannelId],
    queryFn: () => fetchMessages(activeChannelId!),
    enabled: activeChannelId !== null,
    refetchOnWindowFocus: false,
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // SSE subscription for real-time updates
  useEffect(() => {
    if (activeChannelId === null) return;
    const es = new EventSource(`/api/chat/channels/${activeChannelId}/stream`);
    es.onmessage = (e) => {
      const msg: Message = JSON.parse(e.data);
      qc.setQueryData<Message[]>(["chat-messages", activeChannelId], (prev = []) => {
        // Deduplicate by id
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [activeChannelId, qc]);

  const sendMutation = useMutation({
    mutationFn: ({ content }: { content: string }) =>
      sendMessage(activeChannelId!, content, user?.id),
    onSuccess: (msg) => {
      // SSE will deliver it; optimistic add as fallback
      qc.setQueryData<Message[]>(["chat-messages", activeChannelId], (prev = []) => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    },
  });

  const handleSend = useCallback(() => {
    const content = draft.trim();
    if (!content || sendMutation.isPending) return;
    setDraft("");
    sendMutation.mutate({ content });
    textareaRef.current?.focus();
  }, [draft, sendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeChannel = channels.find(c => c.id === activeChannelId);

  // Group channels
  const generalChannels = channels.filter(c => c.type === "general" || c.type === "direct");
  const caseChannels = channels.filter(c => c.type === "case");

  return (
    <div className="flex h-[calc(100vh-0px)] bg-background">
      {/* ── Channel sidebar ── */}
      <div className="w-60 shrink-0 flex flex-col border-r border-border bg-muted/30">
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Channels</span>
          <button
            onClick={() => setShowModal(true)}
            className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="New channel"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {loadingChannels ? (
            <div className="px-2 py-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {generalChannels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => setActiveChannelId(ch.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors",
                    activeChannelId === ch.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Hash className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{ch.name}</span>
                </button>
              ))}

              {caseChannels.length > 0 && (
                <>
                  <div className="px-2 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">Case Rooms</div>
                  {caseChannels.map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => setActiveChannelId(ch.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors",
                        activeChannelId === ch.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <Lock className="h-3 w-3 shrink-0" />
                      <span className="truncate">{ch.caseName ?? ch.name}</span>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Message pane ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeChannel ? (
          <>
            {/* Header */}
            <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-border bg-background">
              <Hash className="h-5 w-5 text-muted-foreground" />
              <div>
                <h1 className="font-semibold text-foreground leading-none">{activeChannel.name}</h1>
                {activeChannel.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{activeChannel.description}</p>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto py-4 space-y-0">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                  <MessageSquare className="h-10 w-10 opacity-20" />
                  <p className="text-sm">No messages yet. Start the conversation.</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    prevSenderId={i > 0 ? messages[i - 1].senderId : undefined}
                  />
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 px-4 pb-4">
              <div className="flex items-end gap-2 rounded-lg border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message #${activeChannel.name}`}
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground max-h-32"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                />
                <button
                  onClick={handleSend}
                  disabled={!draft.trim() || sendMutation.isPending}
                  className="shrink-0 h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {sendMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Send className="h-4 w-4" />
                  }
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground px-1">Enter to send · Shift+Enter for new line</p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center space-y-2">
              <MessageSquare className="h-12 w-12 mx-auto opacity-20" />
              <p className="text-sm">Select a channel to start chatting</p>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <NewChannelModal
          userId={user?.id}
          onClose={() => setShowModal(false)}
          onCreated={(c) => {
            qc.invalidateQueries({ queryKey: ["chat-channels"] });
            setActiveChannelId(c.id);
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}
