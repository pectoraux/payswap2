/**
 * PaySwap Runtime — Command Pattern.
 *
 * Every change to the financial world is a Command. Commands express INTENT
 * but don't know HOW. The Financial Solver translates Commands into Execution
 * Graphs.
 *
 *   TransferLiquidity   — move value from A to B
 *   MintAsset           — mint a twin token
 *   BurnAsset           — burn a twin token
 *   MoveReserve         — rebalance reserves across countries
 *   StakeLP             — LP stakes twin tokens
 *   UnstakeLP           — LP withdraws stake
 *   CreateClaim         — file an insurance claim
 *   ApproveClaim        — approve/deny a claim
 *   ExecuteSettlement   — settle a transaction
 *   FreezeAccount       — freeze an entity
 *   OpenCorridor        — authorize a new corridor
 *   CloseCorridor       — close a corridor
 *   IssueLoan           — issue a loan
 *
 * Commands are serializable, replayable, and auditable. They are the universal
 * input format for the runtime.
 */
import { uid } from './support';

export type CommandType =
  | 'TransferLiquidity'
  | 'MintAsset'
  | 'BurnAsset'
  | 'MoveReserve'
  | 'StakeLP'
  | 'UnstakeLP'
  | 'CreateClaim'
  | 'ApproveClaim'
  | 'ExecuteSettlement'
  | 'FreezeAccount'
  | 'OpenCorridor'
  | 'CloseCorridor'
  | 'IssueLoan'
  | 'ConvertStablecoin'
  | 'ReplenishReserve';

export interface Command {
  id: string;
  type: CommandType;
  ts: number;
  actor: string;
  params: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Factory: create a Command. */
export function command(type: CommandType, params: Record<string, unknown>, actor = 'system'): Command {
  return { id: uid('cmd'), type, ts: Date.now(), actor, params };
}

/** Convenience builders for common commands. */
export const Commands = {
  transferLiquidity: (from: string, to: string, amount: number, currency: string, actor?: string) =>
    command('TransferLiquidity', { from, to, amount, currency }, actor),

  mintAsset: (assetType: string, amount: number, currency: string, fromCountry: string, toCountry: string, actor?: string) =>
    command('MintAsset', { assetType, amount, currency, fromCountry, toCountry }, actor),

  burnAsset: (assetId: string, amount: number, actor?: string) =>
    command('BurnAsset', { assetId, amount }, actor),

  moveReserve: (fromCountry: string, toCountry: string, amount: number, currency: string, actor?: string) =>
    command('MoveReserve', { fromCountry, toCountry, amount, currency }, actor),

  stakeLP: (lpId: string, amount: number, actor?: string) =>
    command('StakeLP', { lpId, amount }, actor),

  unstakeLP: (lpId: string, amount: number, actor?: string) =>
    command('UnstakeLP', { lpId, amount }, actor),

  createClaim: (amount: number, currency: string, reason: string, actor?: string) =>
    command('CreateClaim', { amount, currency, reason }, actor),

  approveClaim: (claimId: string, approves: boolean, actor?: string) =>
    command('ApproveClaim', { claimId, approves }, actor),

  executeSettlement: (planId: string, actor?: string) =>
    command('ExecuteSettlement', { planId }, actor),

  freezeAccount: (entityId: string, reason: string, actor?: string) =>
    command('FreezeAccount', { entityId, reason }, actor),

  openCorridor: (fromCountry: string, toCountry: string, actor?: string) =>
    command('OpenCorridor', { fromCountry, toCountry }, actor),

  closeCorridor: (fromCountry: string, toCountry: string, actor?: string) =>
    command('CloseCorridor', { fromCountry, toCountry }, actor),

  issueLoan: (borrowerId: string, amount: number, currency: string, interestRate: number, termDays: number, actor?: string) =>
    command('IssueLoan', { borrowerId, amount, currency, interestRate, termDays }, actor),

  convertStablecoin: (from: string, to: string, amount: number, actor?: string) =>
    command('ConvertStablecoin', { from, to, amount }, actor),

  replenishReserve: (country: string, amount: number, currency: string, source: string, actor?: string) =>
    command('ReplenishReserve', { country, amount, currency, source }, actor),
};

/** Human-readable labels for command types. */
export const COMMAND_LABELS: Record<CommandType, string> = {
  TransferLiquidity: 'Transfer Liquidity',
  MintAsset: 'Mint Asset',
  BurnAsset: 'Burn Asset',
  MoveReserve: 'Move Reserve',
  StakeLP: 'Stake LP',
  UnstakeLP: 'Unstake LP',
  CreateClaim: 'Create Claim',
  ApproveClaim: 'Approve Claim',
  ExecuteSettlement: 'Execute Settlement',
  FreezeAccount: 'Freeze Account',
  OpenCorridor: 'Open Corridor',
  CloseCorridor: 'Close Corridor',
  IssueLoan: 'Issue Loan',
  ConvertStablecoin: 'Convert Stablecoin',
  ReplenishReserve: 'Replenish Reserve',
};
