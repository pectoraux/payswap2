import { Badge } from '@/components/ui/badge';

const SUCCESS = new Set([
  'COMPLETED', 'ACTIVE', 'APPROVED', 'PAID', 'SUCCEEDED', 'VERIFIED',
  'JOINED', 'SETTLED', 'LIVE', 'CONVERTED',
]);
const WARN = new Set([
  'PENDING', 'REQUESTED', 'DRAFT', 'PROCESSING', 'SENT', 'INVITED',
  'UNVERIFIED', 'REVIEW',
]);
const FAIL = new Set([
  'FAILED', 'REJECTED', 'CANCELED', 'CANCELLED', 'FROZEN', 'EXPIRED',
  'REVOKED', 'DECLINED', 'CHARGEDBACK',
]);

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = (status || '').toUpperCase();
  const base = 'border-transparent text-[10px] font-medium capitalize';
  if (SUCCESS.has(s)) {
    return (
      <Badge className={`${base} bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 ${className || ''}`}>
        {status}
      </Badge>
    );
  }
  if (WARN.has(s)) {
    return (
      <Badge className={`${base} bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 ${className || ''}`}>
        {status}
      </Badge>
    );
  }
  if (FAIL.has(s)) {
    return (
      <Badge className={`${base} bg-rose-500/15 text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 ${className || ''}`}>
        {status}
      </Badge>
    );
  }
  return <Badge variant="secondary" className={`text-[10px] font-medium capitalize ${className || ''}`}>{status}</Badge>;
}
