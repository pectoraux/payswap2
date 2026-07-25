/**
 * PaySwap Protocol — Liquidity Auctions.
 *
 * Instead of statically selecting LPs, LPs answer liquidity requests.
 * The solver builds the best execution graph from auction responses.
 */
import { uid, round } from '@/kernel/support';

export interface AuctionBid {
  lpId: string;
  amount: number;
  feeRate: number;  // percent
  timestamp: number;
}

export interface LiquidityAuction {
  id: string;
  amount: number;
  currency: string;
  country: string;
  deadlineMs: number;
  bids: AuctionBid[];
  status: 'open' | 'closed' | 'awarded';
  winnerBids: AuctionBid[];
  openedAt: number;
  closedAt: number | null;
}

export class AuctionEngine {
  private auctions: Map<string, LiquidityAuction> = new Map();

  /** Open a liquidity auction. */
  open(amount: number, currency: string, country: string, deadlineMs: number = 20000): LiquidityAuction {
    const auction: LiquidityAuction = {
      id: uid('auction'),
      amount,
      currency,
      country,
      deadlineMs,
      bids: [],
      status: 'open',
      winnerBids: [],
      openedAt: Date.now(),
      closedAt: null,
    };
    this.auctions.set(auction.id, auction);
    return auction;
  }

  /** LP submits a bid. */
  bid(auctionId: string, lpId: string, amount: number, feeRate: number): AuctionBid | undefined {
    const auction = this.auctions.get(auctionId);
    if (!auction || auction.status !== 'open') return undefined;
    const bid: AuctionBid = { lpId, amount, feeRate, timestamp: Date.now() };
    auction.bids.push(bid);
    return bid;
  }

  /** Close the auction and select the best bids (cheapest combination that covers the amount). */
  close(auctionId: string): LiquidityAuction | undefined {
    const auction = this.auctions.get(auctionId);
    if (!auction || auction.status !== 'open') return undefined;

    // Sort bids by fee rate ascending (cheapest first)
    const sorted = [...auction.bids].sort((a, b) => a.feeRate - b.feeRate);

    // Greedily fill the amount from cheapest bids
    let remaining = auction.amount;
    const winners: AuctionBid[] = [];
    for (const bid of sorted) {
      if (remaining <= 0) break;
      const drawn = Math.min(remaining, bid.amount);
      winners.push({ ...bid, amount: drawn });
      remaining -= drawn;
    }

    auction.winnerBids = winners;
    auction.status = remaining <= 0 ? 'awarded' : 'closed';
    auction.closedAt = Date.now();
    return auction;
  }

  get(auctionId: string): LiquidityAuction | undefined {
    return this.auctions.get(auctionId);
  }

  all(): LiquidityAuction[] {
    return [...this.auctions.values()];
  }
}

export const auctionEngine = new AuctionEngine();
