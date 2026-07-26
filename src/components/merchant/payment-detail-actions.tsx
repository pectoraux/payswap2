'use client';

import { useState } from 'react';
import { Copy, Check, Download, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * CopyPaymentIdButton — copies the payment ID to the clipboard and shows
 * inline feedback (checkmark) for 1.5s. Falls back to a toast on failure.
 */
export function CopyPaymentIdButton({ paymentId }: { paymentId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(paymentId);
      } else {
        // Legacy fallback for older browsers.
        const ta = document.createElement('textarea');
        ta.value = paymentId;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success('Payment ID copied');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy payment ID');
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className="gap-1.5"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
      {copied ? 'Copied' : 'Copy ID'}
    </Button>
  );
}

interface ReceiptData {
  reference: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  description: string | null;
  createdAt: string;
  settledAt: string | null;
  merchantName: string;
  merchantEmail: string;
  customerName: string | null;
  customerEmail: string | null;
}

/**
 * DownloadReceiptButton — opens a print-friendly receipt in a new window.
 *
 * We build the receipt as an inline HTML string and write it into a blank
 * tab, then trigger `window.print()`. This avoids needing a dedicated
 * receipt route while still giving the user a real "Download / Save as PDF"
 * flow via the browser print dialog.
 */
export function DownloadReceiptButton({ payment }: { payment: ReceiptData }) {
  function handleDownload() {
    const fmt = (n: number, c: string) => {
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: c,
        }).format(n);
      } catch {
        return `${n.toFixed(2)} ${c}`;
      }
    };
    const fmtDate = (s: string | null) => {
      if (!s) return '—';
      try {
        return new Date(s).toLocaleString();
      } catch {
        return s;
      }
    };

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Receipt · ${escapeHtml(payment.reference || payment.paymentId)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 48px; color: #0f172a; background: #fff; }
  .wrap { max-width: 720px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
  .logo { width: 40px; height: 40px; border-radius: 10px; background: #059669; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; }
  .brand-name { font-size: 18px; font-weight: 700; }
  .brand-sub { font-size: 12px; color: #64748b; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .muted { color: #64748b; font-size: 13px; }
  .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-top: 24px; }
  .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
  .row:last-child { border-bottom: none; }
  .row .k { color: #64748b; }
  .row .v { font-weight: 600; text-align: right; }
  .amount { font-size: 32px; font-weight: 700; color: #059669; margin-top: 8px; }
  .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #ecfdf5; color: #047857; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
  .print-btn { position: fixed; top: 16px; right: 16px; background: #059669; color: #fff; border: none; padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>
  <div class="wrap">
    <div class="brand">
      <div class="logo">P</div>
      <div>
        <div class="brand-name">PaySwap</div>
        <div class="brand-sub">Payment receipt</div>
      </div>
    </div>
    <h1>Receipt</h1>
    <p class="muted">Reference ${escapeHtml(payment.reference || payment.paymentId)}</p>
    <div class="amount">${escapeHtml(fmt(payment.amount, payment.currency))}</div>
    <p style="margin-top:8px"><span class="pill">${escapeHtml(payment.status)}</span></p>

    <div class="card">
      <div class="row"><span class="k">Payment ID</span><span class="v" style="font-family:monospace;font-size:11px">${escapeHtml(payment.paymentId)}</span></div>
      <div class="row"><span class="k">Method</span><span class="v">${escapeHtml(payment.method || '—')}</span></div>
      <div class="row"><span class="k">Description</span><span class="v">${escapeHtml(payment.description || '—')}</span></div>
      <div class="row"><span class="k">Created</span><span class="v">${escapeHtml(fmtDate(payment.createdAt))}</span></div>
      <div class="row"><span class="k">Settled</span><span class="v">${escapeHtml(fmtDate(payment.settledAt))}</span></div>
    </div>

    <div class="card">
      <div class="row"><span class="k">Merchant</span><span class="v">${escapeHtml(payment.merchantName)}</span></div>
      <div class="row"><span class="k">Merchant email</span><span class="v">${escapeHtml(payment.merchantEmail)}</span></div>
      <div class="row"><span class="k">Customer</span><span class="v">${escapeHtml(payment.customerName || '—')}</span></div>
      <div class="row"><span class="k">Customer email</span><span class="v">${escapeHtml(payment.customerEmail || '—')}</span></div>
    </div>

    <div class="footer">
      This receipt was generated by PaySwap. · ${escapeHtml(fmtDate(new Date().toISOString()))}
    </div>
  </div>
  <script>
    window.addEventListener('load', function() { setTimeout(function() { window.print(); }, 350); });
  </script>
</body>
</html>`;

    const w = window.open('', '_blank', 'noopener,noreferrer,width=820,height=900');
    if (!w) {
      toast.error('Pop-up blocked — allow pop-ups to download the receipt');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleDownload}
      className="gap-1.5"
    >
      <Download className="h-4 w-4" />
      Download Receipt
    </Button>
  );
}

/**
 * CreateRefundLinkButton — a plain anchor styled as a button that links to
 * the refunds page with the payment ID pre-filled in the query string.
 */
export function CreateRefundLinkButton({ paymentId }: { paymentId: string }) {
  return (
    <Button
      asChild
      size="sm"
      className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
    >
      <a href={`/dashboard/refunds?paymentId=${encodeURIComponent(paymentId)}`}>
        <RotateCcw className="h-4 w-4" />
        Create Refund
      </a>
    </Button>
  );
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
