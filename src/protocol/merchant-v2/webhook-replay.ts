/**
 * PaySwap Protocol — Merchant Platform (v2) — Webhook Replay.
 *
 * Re-deliver past webhook deliveries after a merchant's endpoint was
 * unavailable. The merchant requests a replay by `deliveryId`; the
 * service looks up the original delivery in the `webhookEngine`, re-emits
 * the same event type + payload (which creates a new delivery record with
 * a fresh signature), and links the new delivery back to the replay
 * request.
 *
 * Lifecycle:
 *   pending → replayed  (`executeReplay` succeeded)
 *   pending → failed    (`executeReplay` failed — e.g. delivery not found,
 *                         endpoint no longer active, or delivery error)
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `merchant.webhook_replay_requested` — on `requestReplay`.
 *  - `merchant.webhook_replayed`         — on `executeReplay` success.
 *  - `merchant.webhook_replay_failed`    — on `executeReplay` failure.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and
 * `webhookEngine` from `@/protocol/webhooks/engine`.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { webhookEngine } from '@/protocol/webhooks/engine';
import type { WebhookReplayFilter, WebhookReplayRequest } from './types';

/** Filter for `bulkReplay`. */
export interface BulkReplayFilter extends WebhookReplayFilter {
  endpointId?: string;
  eventType?: string;
}

/**
 * WebhookReplayService owns replay-request records and delegates the
 * actual re-delivery to the existing `webhookEngine`.
 */
export class WebhookReplayService {
  private replays = new Map<string, WebhookReplayRequest>();

  // ----------------------------------------------------------------- requestReplay
  /**
   * Request a replay of a single delivery. The replay is created in
   * `pending` state; call `executeReplay` to actually re-deliver.
   */
  requestReplay(merchantId: string, deliveryId: string): WebhookReplayRequest {
    const replay: WebhookReplayRequest = {
      id: uid('whr'),
      merchantId,
      deliveryId,
      status: 'pending',
      requestedAt: nowTs(),
    };
    this.replays.set(replay.id, replay);
    eventEngine.emit('merchant.webhook_replay_requested', {
      merchantId,
      replayId: replay.id,
      deliveryId,
    });
    return replay;
  }

  // ------------------------------------------------------------------ executeReplay
  /**
   * Execute a pending replay. Looks up the original delivery, re-emits
   * the same event type + payload via the `webhookEngine`, and links
   * the new delivery id back to the replay record. Returns the updated
   * replay, or `null` if the replay is missing or already executed.
   */
  async executeReplay(replayId: string): Promise<WebhookReplayRequest | null> {
    const replay = this.replays.get(replayId);
    if (!replay || replay.status !== 'pending') return null;
    const original = webhookEngine
      .allDeliveries()
      .find((d) => d.id === replay.deliveryId && d.merchantId === replay.merchantId);
    if (!original) {
      replay.status = 'failed';
      replay.replayedAt = nowTs();
      replay.error = 'original delivery not found';
      eventEngine.emit('merchant.webhook_replay_failed', {
        merchantId: replay.merchantId,
        replayId,
        deliveryId: replay.deliveryId,
        error: replay.error,
      });
      return replay;
    }
    try {
      const newDeliveries = await webhookEngine.emit({
        merchantId: replay.merchantId,
        eventType: original.eventType,
        payload: original.payload,
      });
      if (newDeliveries.length === 0) {
        replay.status = 'failed';
        replay.replayedAt = nowTs();
        replay.error = 'no active endpoint subscribed';
        eventEngine.emit('merchant.webhook_replay_failed', {
          merchantId: replay.merchantId,
          replayId,
          deliveryId: replay.deliveryId,
          error: replay.error,
        });
        return replay;
      }
      replay.status = 'replayed';
      replay.replayedAt = nowTs();
      replay.newDeliveryId = newDeliveries[0].id;
      eventEngine.emit('merchant.webhook_replayed', {
        merchantId: replay.merchantId,
        replayId,
        originalDeliveryId: replay.deliveryId,
        newDeliveryId: replay.newDeliveryId,
        eventType: original.eventType,
      });
      return replay;
    } catch (err) {
      replay.status = 'failed';
      replay.replayedAt = nowTs();
      replay.error = err instanceof Error ? err.message : String(err);
      eventEngine.emit('merchant.webhook_replay_failed', {
        merchantId: replay.merchantId,
        replayId,
        deliveryId: replay.deliveryId,
        error: replay.error,
      });
      return replay;
    }
  }

  // --------------------------------------------------------------------- bulkReplay
  /**
   * Replay multiple deliveries for a merchant. By default replays all
   * `failed` deliveries in the last 7 days; pass a filter to narrow.
   * Returns the list of replay requests created (each in `pending` state
   * — call `executeReplay` on each, or use `bulkReplayAndExecute`).
   */
  bulkReplay(merchantId: string, filter?: BulkReplayFilter): WebhookReplayRequest[] {
    const now = nowTs();
    const from = filter?.from ?? now - 7 * 24 * 60 * 60 * 1000;
    const to = filter?.to ?? now;
    const deliveries = webhookEngine
      .allDeliveries()
      .filter((d) => {
        if (d.merchantId !== merchantId) return false;
        if (d.deliveredAt < from || d.deliveredAt > to) return false;
        if (filter?.endpointId && d.endpointId !== filter.endpointId) return false;
        if (filter?.eventType && d.eventType !== filter.eventType) return false;
        // By default replay only failed deliveries; if a status filter is
        // provided, honour it. If `status='replayed'` is requested (i.e.
        // re-replay past replays), we still match on delivery status.
        if (filter?.status) return true; // status filter is for replay records, not deliveries
        return d.status === 'failed';
      });
    const replays: WebhookReplayRequest[] = [];
    for (const d of deliveries) {
      replays.push(this.requestReplay(merchantId, d.id));
    }
    return replays;
  }

  /**
   * Convenience: bulk-replay + immediately execute each. Returns the
   * executed replay records.
   */
  async bulkReplayAndExecute(
    merchantId: string,
    filter?: BulkReplayFilter,
  ): Promise<WebhookReplayRequest[]> {
    const replays = this.bulkReplay(merchantId, filter);
    const executed: WebhookReplayRequest[] = [];
    for (const r of replays) {
      const result = await this.executeReplay(r.id);
      if (result) executed.push(result);
    }
    return executed;
  }

  // -------------------------------------------------------------------- getters
  getReplay(id: string): WebhookReplayRequest | undefined {
    return this.replays.get(id);
  }

  listReplays(merchantId: string, filter?: WebhookReplayFilter): WebhookReplayRequest[] {
    let list = [...this.replays.values()].filter((r) => r.merchantId === merchantId);
    if (filter) {
      if (filter.status) list = list.filter((r) => r.status === filter.status);
      if (typeof filter.from === 'number') list = list.filter((r) => r.requestedAt >= filter.from!);
      if (typeof filter.to === 'number') list = list.filter((r) => r.requestedAt <= filter.to!);
    }
    return list.sort((a, b) => b.requestedAt - a.requestedAt);
  }

  all(): WebhookReplayRequest[] {
    return [...this.replays.values()];
  }

  // --------------------------------------------------------------------- reset
  reset(): void {
    this.replays.clear();
  }
}

// Singleton.
const _g = globalThis as unknown as { __PAYSWAP_WEBHOOK_REPLAY_SERVICE?: WebhookReplayService };
export const webhookReplayService: WebhookReplayService =
  _g.__PAYSWAP_WEBHOOK_REPLAY_SERVICE ?? new WebhookReplayService();
if (!_g.__PAYSWAP_WEBHOOK_REPLAY_SERVICE) {
  _g.__PAYSWAP_WEBHOOK_REPLAY_SERVICE = webhookReplayService;
}
