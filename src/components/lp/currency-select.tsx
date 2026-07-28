'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  CURRENCIES,
  type CurrencyInfo,
  getCurrency,
  matchCurrency,
} from '@/lib/currencies';

export interface CurrencySelectProps {
  /** Currently selected ISO code (e.g. "GHS"). */
  value: string;
  /** Fires with the new ISO code on selection. */
  onValueChange: (code: string) => void;
  /** Placeholder shown when no value is set. */
  placeholder?: string;
  /** Disable the trigger + dropdown. */
  disabled?: boolean;
  /** Small visual variant for compact table rows. */
  size?: 'sm' | 'md';
  /** Optional id forwarded to the trigger button. */
  id?: string;
  /** Optional extra trigger className. */
  className?: string;
  /**
   * Optional allow-list — when set, only currencies whose code is in this
   * array appear in the dropdown. Useful when an LP should only pick from
   * currencies they already support.
   */
  allowedCodes?: readonly string[];
  /** Optional aria-label. */
  ariaLabel?: string;
}

/**
 * `<CurrencySelect />` — a searchable combobox for picking an ISO currency.
 *
 * Built on shadcn `<Popover>` + `<Command>` (cmdk) so LPs can type to filter
 * by code, name, symbol, or country. Returns just the 3-letter ISO code on
 * selection — that's the only thing we persist in the DB.
 *
 * The dropdown shows "{code} — {name} ({symbol})" plus the issuing country on
 * the right so LPs can disambiguate codes that share a symbol (e.g. USD vs
 * ARS both use "$").
 */
export function CurrencySelect({
  value,
  onValueChange,
  placeholder = 'Select currency',
  disabled = false,
  size = 'md',
  id,
  className,
  allowedCodes,
  ariaLabel,
}: CurrencySelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const list = React.useMemo<CurrencyInfo[]>(() => {
    const base = allowedCodes && allowedCodes.length > 0
      ? CURRENCIES.filter((c) => allowedCodes.includes(c.code))
      : (CURRENCIES as readonly CurrencyInfo[]).slice();
    return base.filter((c) => matchCurrency(query, c));
  }, [allowedCodes, query]);

  const selected = getCurrency(value);

  const triggerClasses = cn(
    'font-mono',
    size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm',
    !value && 'text-muted-foreground',
    className,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? 'Select currency'}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', triggerClasses)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {value ? (
              <>
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  {selected.code}
                </span>
                <span className="truncate font-sans text-xs text-muted-foreground">
                  {selected.name}
                </span>
              </>
            ) : (
              <span className="truncate">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by code, name or country…"
            value={query}
            onValueChange={setQuery}
            className="h-9"
          />
          <CommandList className="max-h-72">
            <CommandEmpty>
              <span className="flex items-center justify-center gap-1.5 py-3 text-xs text-muted-foreground">
                <Search className="h-3 w-3" /> No currency matches “{query}”.
              </span>
            </CommandEmpty>
            <CommandGroup>
              {list.map((c) => {
                const isSelected = c.code === value;
                return (
                  <CommandItem
                    key={c.code}
                    value={c.code}
                    onSelect={() => {
                      onValueChange(c.code);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="gap-2"
                  >
                    <Check
                      className={cn(
                        'h-3.5 w-3.5',
                        isSelected ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                      {c.code}
                    </span>
                    <span className="flex-1 truncate text-xs">{c.name}</span>
                    {c.symbol && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {c.symbol}
                      </span>
                    )}
                    {c.country && (
                      <span className="text-[10px] text-muted-foreground/70">
                        {c.country}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
