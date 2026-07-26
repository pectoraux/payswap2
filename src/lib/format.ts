/**
 * Shared formatting helpers used across merchant + admin pages.
 */

export function formatCurrency(amount: number, currency = 'USD', options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
      ...options,
    }).format(amount ?? 0);
  } catch {
    return `${(amount ?? 0).toFixed(2)} ${currency}`;
  }
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
}

export function formatDate(date: Date | string | null | undefined, withTime = false): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: '2-digit' };
  return new Intl.DateTimeFormat('en-US', opts).format(d);
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
}

/**
 * Status → badge className mapping used for payment/payout/invoice status pills.
 */
export function statusBadgeClass(status: string): string {
  const s = (status || '').toUpperCase();
  if (['COMPLETED', 'ACTIVE', 'PAID', 'APPROVED', 'VERIFIED'].includes(s)) {
    return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
  }
  if (['PENDING', 'PROCESSING', 'REVIEWING', 'REQUESTED', 'SENT', 'DRAFT', 'SETTLING'].includes(s)) {
    return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
  }
  if (['FAILED', 'REJECTED', 'CANCELLED', 'VOID', 'SUSPENDED', 'OVERDUE', 'FROZEN'].includes(s)) {
    return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
  }
  return 'bg-muted text-muted-foreground border-border';
}
