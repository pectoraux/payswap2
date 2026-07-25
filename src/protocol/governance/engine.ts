/**
 * PaySwap Protocol — Governance Module.
 *
 * Protocol parameter evolution through proposals and voting.
 * Governance proposals are entities with capabilities. Execution requires
 * community + PaySwap weighted voting.
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

export type GovernanceProposalState =
  | 'proposed'
  | 'voting'
  | 'passed'
  | 'rejected'
  | 'executed'
  | 'cancelled';

export type GovernanceAction =
  | 'update_parameter'
  | 'add_corridor'
  | 'remove_corridor'
  | 'slash_lp'
  | 'upgrade_merchant_tier'
  | 'emergency_pause'
  | 'treasury_rebalance'
  | 'custom';

export interface GovernanceProposal {
  id: string;
  action: GovernanceAction;
  title: string;
  description: string;
  proposerId: string;
  state: GovernanceProposalState;
  params: Record<string, unknown>;
  votes: { for: number; against: number; voters: { voterId: string; for: boolean; weight: number; ts: number }[] };
  quorum: number;
  passThreshold: number;
  votingDeadline: number;
  proposedAt: number;
  executedAt: number | null;
  history: { state: GovernanceProposalState; ts: number; detail: string }[];
}

export class GovernanceEngine {
  private proposals: Map<string, GovernanceProposal> = new Map();
  private parameters: Map<string, number | string | boolean> = new Map();

  constructor() {
    // Default protocol parameters
    this.parameters.set('max_lp_share', 0.7);
    this.parameters.set('max_cost_percent', 5);
    this.parameters.set('max_risk_score', 0.6);
    this.parameters.set('auction_timeout_ms', 20000);
    this.parameters.set('escrow_ttl_ms', 600000);
    this.parameters.set('min_confidence', 0.3);
    this.parameters.set('min_merchant_bond', 1000);
    this.parameters.set('voting_quorum', 10);
    this.parameters.set('voting_pass_threshold', 0.6);
  }

  /** Propose a governance action. */
  propose(params: {
    action: GovernanceAction;
    title: string;
    description: string;
    proposerId: string;
    params: Record<string, unknown>;
    votingDurationMs?: number;
  }): GovernanceProposal {
    const proposal: GovernanceProposal = {
      id: uid('gov'),
      action: params.action,
      title: params.title,
      description: params.description,
      proposerId: params.proposerId,
      state: 'proposed',
      params: params.params,
      votes: { for: 0, against: 0, voters: [] },
      quorum: this.getParameter('voting_quorum') as number,
      passThreshold: this.getParameter('voting_pass_threshold') as number,
      votingDeadline: Date.now() + (params.votingDurationMs ?? 86400000),
      proposedAt: Date.now(),
      executedAt: null,
      history: [],
    };
    this.proposals.set(proposal.id, proposal);
    proposal.history.push({ state: 'proposed', ts: Date.now(), detail: `Proposed by ${params.proposerId}` });
    eventEngine.emit('governance.proposed', { proposalId: proposal.id, action: proposal.action, title: proposal.title }, 0);
    return proposal;
  }

  /** Start voting phase. */
  startVoting(proposalId: string): GovernanceProposal | null {
    const p = this.proposals.get(proposalId);
    if (!p || p.state !== 'proposed') return null;
    p.state = 'voting';
    p.history.push({ state: 'voting', ts: Date.now(), detail: 'Voting opened' });
    eventEngine.emit('governance.voting_started', { proposalId }, 0);
    return p;
  }

  /** Cast a vote. */
  vote(proposalId: string, voterId: string, forProposal: boolean, weight: number = 1): GovernanceProposal | null {
    const p = this.proposals.get(proposalId);
    if (!p || p.state !== 'voting') return null;
    if (Date.now() > p.votingDeadline) return null;

    // Check if already voted
    if (p.votes.voters.some((v) => v.voterId === voterId)) return null;

    p.votes.voters.push({ voterId, for: forProposal, weight, ts: Date.now() });
    if (forProposal) p.votes.for += weight;
    else p.votes.against += weight;

    eventEngine.emit('governance.vote_cast', { proposalId, voterId, forProposal, weight }, 0);
    return p;
  }

  /** Tally votes and determine outcome. */
  tally(proposalId: string): GovernanceProposal | null {
    const p = this.proposals.get(proposalId);
    if (!p || p.state !== 'voting') return null;

    const totalVotes = p.votes.for + p.votes.against;
    if (totalVotes < p.quorum) {
      p.state = 'rejected';
      p.history.push({ state: 'rejected', ts: Date.now(), detail: `Quorum not met: ${totalVotes}/${p.quorum}` });
    } else {
      const passRate = p.votes.for / totalVotes;
      if (passRate >= p.passThreshold) {
        p.state = 'passed';
        p.history.push({ state: 'passed', ts: Date.now(), detail: `Passed: ${p.votes.for}/${totalVotes} (${round(passRate * 100, 1)}%)` });
      } else {
        p.state = 'rejected';
        p.history.push({ state: 'rejected', ts: Date.now(), detail: `Rejected: ${p.votes.for}/${totalVotes} (${round(passRate * 100, 1)}%)` });
      }
    }

    eventEngine.emit('governance.tallied', { proposalId, state: p.state, for: p.votes.for, against: p.votes.against }, 0);
    return p;
  }

  /** Execute a passed proposal. */
  execute(proposalId: string): GovernanceProposal | null {
    const p = this.proposals.get(proposalId);
    if (!p || p.state !== 'passed') return null;

    // Apply parameter changes
    if (p.action === 'update_parameter') {
      const key = p.params.key as string;
      const value = p.params.value as number | string | boolean;
      this.parameters.set(key, value);
    }

    p.state = 'executed';
    p.executedAt = Date.now();
    p.history.push({ state: 'executed', ts: Date.now(), detail: `Executed: ${p.action}` });
    eventEngine.emit('governance.executed', { proposalId, action: p.action }, 0);
    return p;
  }

  /** Get a protocol parameter. */
  getParameter(key: string): number | string | boolean | undefined { return this.parameters.get(key); }

  /** Set a parameter (governance only — not for direct use). */
  setParameter(key: string, value: number | string | boolean): void { this.parameters.set(key, value); }

  get(proposalId: string): GovernanceProposal | undefined { return this.proposals.get(proposalId); }
  all(): GovernanceProposal[] { return [...this.proposals.values()]; }
  active(): GovernanceProposal[] { return this.all().filter((p) => p.state === 'proposed' || p.state === 'voting'); }
  allParameters(): Record<string, number | string | boolean> { return Object.fromEntries(this.parameters); }

  reset(): void { this.proposals.clear(); }
}

export const governanceEngine = new GovernanceEngine();
