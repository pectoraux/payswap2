'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Keyboard, Command as CommandIcon } from 'lucide-react';

export interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutEntry {
  keys: React.ReactNode;
  description: string;
}

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

function Cmd() {
  return IS_MAC ? <>⌘</> : <>Ctrl</>;
}

const SHORTCUTS: ShortcutEntry[] = [
  {
    keys: (
      <>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          <Cmd />
        </kbd>
        <span className="text-muted-foreground">+</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          K
        </kbd>
      </>
    ),
    description: 'Open the command palette',
  },
  {
    keys: (
      <>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          <Cmd />
        </kbd>
        <span className="text-muted-foreground">+</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          \
        </kbd>
      </>
    ),
    description: 'Toggle the sidebar (mobile only)',
  },
  {
    keys: (
      <>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          G
        </kbd>
        <span className="text-muted-foreground">then</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          D
        </kbd>
      </>
    ),
    description: 'Go to Dashboard',
  },
  {
    keys: (
      <>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          G
        </kbd>
        <span className="text-muted-foreground">then</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          P
        </kbd>
      </>
    ),
    description: 'Go to Payments',
  },
  {
    keys: (
      <>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          G
        </kbd>
        <span className="text-muted-foreground">then</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          C
        </kbd>
      </>
    ),
    description: 'Go to Customers',
  },
  {
    keys: (
      <>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          G
        </kbd>
        <span className="text-muted-foreground">then</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          S
        </kbd>
      </>
    ),
    description: 'Go to Settings',
  },
  {
    keys: (
      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
        ?
      </kbd>
    ),
    description: 'Show this help dialog',
  },
];

/**
 * Dialog that lists every keyboard shortcut available in the shell.
 *
 * Rendered once by the `UnifiedShell`. The shell owns the `?` key listener
 * that opens this dialog; this component just renders the dialog UI.
 */
export function KeyboardShortcutsHelp({ open, onOpenChange }: KeyboardShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Keyboard className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Press these keys anywhere in the dashboard to navigate faster.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {SHORTCUTS.map((s, idx) => (
            <li
              key={idx}
              className="flex items-center justify-between gap-3 rounded-md border bg-card/40 px-3 py-2"
            >
              <span className="text-sm text-muted-foreground">
                {s.description}
              </span>
              <span className="flex shrink-0 items-center gap-1">{s.keys}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          <CommandIcon className="h-2.5 w-2.5" />
          <span>Press</span>
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
            Esc
          </kbd>
          <span>to close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook that owns the open state for the keyboard shortcuts dialog and
 * registers a global `g` then-letter sequence listener for the
 * `G → D / P / C / S` shortcuts.
 *
 * Returns `{ open, setOpen }` so the shell can wire up its `?` shortcut
 * listener to the same state.
 */
export function useKeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let gPressed = false;
    let gTimer: number | undefined;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (isEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();

      if (key === 'g' && !gPressed) {
        gPressed = true;
        // Reset the prefix if the second key doesn't arrive in time.
        gTimer = window.setTimeout(() => {
          gPressed = false;
        }, 800);
        return;
      }

      if (gPressed) {
        const href =
          key === 'd'
            ? '/dashboard'
            : key === 'p'
              ? '/dashboard/payments'
              : key === 'c'
                ? '/dashboard/customers'
                : key === 's'
                  ? '/dashboard/settings'
                  : null;
        if (href) {
          e.preventDefault();
          router.push(href);
        }
        gPressed = false;
        if (gTimer) window.clearTimeout(gTimer);
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (gTimer) window.clearTimeout(gTimer);
    };
  }, [router]);

  return { open, setOpen };
}
