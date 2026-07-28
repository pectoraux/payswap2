'use client';

import * as React from 'react';
import {
  Bot,
  Send,
  Sparkles,
  Loader2,
  RefreshCw,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED_QUESTIONS = [
  "What's the difference between source and destination currency?",
  'How much fee should I charge for the GHS→NGN corridor?',
  'What happens if I set my capacity too high?',
  'How do I withdraw my LP earnings?',
  'What is reputation and how do I improve it?',
];

/**
 * LpAiAssistant — a floating chat button (bottom-right) that opens a side
 * sheet with a context-aware AI assistant.
 *
 * The assistant calls `POST /api/lp/ai-assistant` with the conversation
 * history; the API looks up the LP's live state (stake, corridors, recent
 * settlements) and passes it to the LLM as a system prompt. If the LLM
 * fails the API returns a deterministic fallback reply.
 *
 * Persistence: conversation is held in component state only (no DB write)
 * — closing the sheet resets it. This is intentional: most LP questions are
 * ephemeral and don't need history.
 */
export function LpAiAssistant() {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever messages change.
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/lp/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Assistant request failed (${res.status})`);
      }
      const reply: string = typeof data.reply === 'string' ? data.reply : '';
      if (!reply) throw new Error('Assistant returned an empty reply');
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Assistant request failed');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter to send, Shift+Enter for newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function resetConversation() {
    setMessages([]);
    setInput('');
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Floating button */}
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open LP AI assistant"
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 transition-all hover:scale-105 hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/30 sm:h-14 sm:w-14"
        >
          <Bot className="h-5 w-5 sm:h-6 sm:w-6" />
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
          </span>
        </button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b bg-gradient-to-br from-emerald-500/[0.06] to-transparent p-4">
          <div className="flex items-center justify-between pr-6">
            <SheetTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Bot className="h-4 w-4" />
              </span>
              LP Assistant
            </SheetTitle>
            {messages.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetConversation}
                className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
                aria-label="Reset conversation"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>
          <SheetDescription className="text-xs">
            Context-aware AI that knows your stake, corridors, and recent
            settlements.
          </SheetDescription>
        </SheetHeader>

        {/* Chat transcript */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto p-4"
        >
          {messages.length === 0 ? (
            <WelcomeState onPick={send} />
          ) : (
            messages.map((m, i) => <MessageBubble key={i} message={m} />)
          )}
          {loading && <TypingIndicator />}
        </div>

        {/* Input box */}
        <form
          onSubmit={handleSubmit}
          className="border-t bg-card/30 p-3"
        >
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about fees, capacity, corridors…"
              rows={1}
              maxLength={1000}
              className="min-h-[40px] max-h-32 resize-none text-sm"
              disabled={loading}
            />
            <Button
              type="submit"
              size="icon"
              disabled={loading || !input.trim()}
              className="h-9 w-9 shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
              aria-label="Send message"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Enter to send · Shift+Enter for newline · Up to 1,000 characters
          </p>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function WelcomeState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Sparkles className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-semibold">How can I help you today?</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          I can answer questions about your LP position, recommend fees,
          explain how corridors work, and walk you through deposits and
          withdrawals.
        </p>
      </div>
      <div className="w-full space-y-1.5">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="h-3 w-3" /> Try one of these:
        </p>
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="w-full rounded-lg border bg-card/50 px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.04] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
          isUser
            ? 'bg-emerald-600 text-white'
            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        )}
        aria-hidden
      >
        {isUser ? 'LP' : <Bot className="h-3.5 w-3.5" />}
      </span>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
          isUser
            ? 'rounded-tr-sm bg-emerald-600 text-white'
            : 'rounded-tl-sm bg-muted text-foreground',
        )}
      >
        <FormattedContent text={message.content} />
      </div>
    </div>
  );
}

/**
 * Tiny markdown-ish renderer: bold **x**, inline `code`, and preserves
 * newlines. We intentionally don't pull in a full markdown parser to keep
 * the bundle small — the assistant's replies are short and use only these
 * two formatting primitives.
 */
function FormattedContent({ text }: { text: string }) {
  // Split into lines so we can preserve paragraph breaks.
  const lines = text.split(/\n/);
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => (
        <p key={i} className="whitespace-pre-wrap break-words">
          {renderInline(line)}
        </p>
      ))}
    </div>
  );
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Tokenize by **bold** and `code`.
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const tok = match[0];
    if (tok.startsWith('**')) {
      nodes.push(
        <strong key={`b-${i}`} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith('`')) {
      nodes.push(
        <code
          key={`c-${i}`}
          className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + tok.length;
    i += 1;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

function TypingIndicator() {
  return (
    <div className="flex gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Bot className="h-3.5 w-3.5" />
      </span>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-muted px-3 py-2.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
      </div>
    </div>
  );
}
