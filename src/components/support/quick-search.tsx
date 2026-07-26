'use client';

import { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function QuickSearch() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    // Placeholder: no-op search
    setTimeout(() => setLoading(false), 600);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email, payment reference, merchant name, or transaction ID…"
          className="h-10 pl-9"
        />
      </div>
      <Button
        type="submit"
        disabled={loading || !query.trim()}
        className="h-10 bg-emerald-600 text-white hover:bg-emerald-700"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
      </Button>
    </form>
  );
}
