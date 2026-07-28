'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Layers, Search, ArrowRight, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Public marketplace header.
 *
 * Sticky top nav with the PaySwap logo, primary nav links, search bar, and
 * a "Publish your plugin" CTA. Used on every /marketplace/* page.
 */
export function MarketplaceHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = React.useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) {
      router.push(`/marketplace/search?q=${encodeURIComponent(q.trim())}`);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/marketplace" className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
            <Layers className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-bold tracking-tight">PaySwap</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Marketplace
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 text-sm md:flex">
          <NavLink href="/marketplace" active={pathname === '/marketplace'}>
            Browse
          </NavLink>
          <NavLink href="/marketplace/search" active={pathname === '/marketplace/search'}>
            Search
          </NavLink>
          <a
            href="#categories"
            className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Categories
          </a>
        </nav>

        <form onSubmit={onSubmit} className="ml-auto hidden flex-1 max-w-md sm:block">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search plugins, rails, wallets, AIs…"
              className="h-9 bg-muted/40 pl-9"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex">
            <Link href="/login">
              Sign in
            </Link>
          </Button>
          <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Link href="/developers/publish">
              <Plus className="h-3.5 w-3.5" /> Publish
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 ${
        active
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * Footer for marketplace pages. Sticky-bottom per the UI/UX spec.
 */
export function MarketplaceFooter() {
  return (
    <footer className="mt-16 border-t border-border/60 bg-muted/20">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
              <Layers className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold">PaySwap Marketplace</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              Every plugin is verified before publishing
            </span>
            <span>© {new Date().getFullYear()} PaySwap</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
