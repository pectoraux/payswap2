/**
 * PaySwap Protocol — Stellar Asset Helpers.
 *
 * Naming convention for PaySwap-issued stablecoins on Stellar:
 *   `TWIN${currency}` — e.g. TWINGHS, TWINKES, TWINNGN
 *
 * These mirror the asset-code rules used by `stellar-sdk` Asset class:
 *   - Native:  Asset.native()  → XLM
 *   - 4-char:  Asset('USDC', issuer)
 *   - 12-char: Asset('TWINGHS', issuer)   ← PaySwap convention
 *
 * 12-char alphanumeric codes are allowed on Stellar since protocol v13.
 */
export const NATIVE_ASSET_CODE = 'XLM';

/** Build a Twin Token asset code for a currency (e.g. GHS → TWINGHS). */
export function twinTokenCode(currency: string): string {
  return `TWIN${currency.toUpperCase()}`;
}

/** Native Stellar asset (XLM). */
export function nativeAsset(): { code: string; issuer?: string } {
  return { code: NATIVE_ASSET_CODE };
}

/** Is this asset code a PaySwap-issued Twin Token? */
export function isTwinToken(code: string): boolean {
  return code.startsWith('TWIN') && code.length > 4;
}

/** Decode the underlying currency from a Twin Token code (TWINGHS → GHS). */
export function twinTokenCurrency(code: string): string | undefined {
  if (!isTwinToken(code)) return undefined;
  return code.slice(4);
}

/** Metadata for a Stellar asset code. */
export interface StellarAssetMetadata {
  code: string;
  issuer?: string;
  isNative: boolean;
  isTwinToken: boolean;
  currency?: string;        // for Twin Tokens
  codeLength: number;       // 3-12 for Stellar custom assets
  assetType: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
}

/** Return metadata describing a Stellar asset. */
export function assetMetadata(code: string, issuer?: string): StellarAssetMetadata {
  const isNative = code === NATIVE_ASSET_CODE;
  const isTwin = isTwinToken(code);
  const len = code.length;
  const assetType: StellarAssetMetadata['assetType'] = isNative
    ? 'native'
    : len <= 4
      ? 'credit_alphanum4'
      : 'credit_alphanum12';

  return {
    code,
    issuer,
    isNative,
    isTwinToken: isTwin,
    currency: isTwin ? twinTokenCurrency(code) : undefined,
    codeLength: len,
    assetType,
  };
}

/** Canonical "CODE:ISSUER" key for an asset (matches Horizon's asset format). */
export function stellarAssetKey(code: string, issuer?: string): string {
  if (code === NATIVE_ASSET_CODE || !issuer) return code;
  return `${code}:${issuer}`;
}

/** Parse a canonical "CODE:ISSUER" key back into parts. */
export function parseStellarAssetKey(key: string): { code: string; issuer?: string } {
  if (key === NATIVE_ASSET_CODE || !key.includes(':')) {
    return { code: key };
  }
  const [code, issuer] = key.split(':');
  return { code, issuer };
}

/**
 * Validate a Stellar asset code.
 *   Native: 'XLM' (no issuer)
 *   Custom: 1-12 chars, uppercase ASCII alphanumeric
 */
export function isValidAssetCode(code: string): boolean {
  if (code === NATIVE_ASSET_CODE) return true;
  if (code.length < 1 || code.length > 12) return false;
  return /^[A-Z0-9]+$/.test(code);
}

/**
 * Generate a deterministic synthetic issuer address for the simulation.
 * Real adapters will use real issuing account keys (G... for Stellar).
 */
export function syntheticIssuerAddress(assetCode: string): string {
  // SHA-like fold of assetCode into a fake G... address (sim only).
  let h = 5381;
  for (let i = 0; i < assetCode.length; i++) {
    h = ((h << 5) + h + assetCode.charCodeAt(i)) | 0;
  }
  const base = (h >>> 0).toString(36).toUpperCase();
  const pad = 'G' + base.padStart(5, '0') + 'SYNTHETICISSUER0000000000';
  return pad.slice(0, 56);
}
