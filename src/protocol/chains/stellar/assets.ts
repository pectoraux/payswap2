/**
 * PaySwap Protocol — Stellar Asset Helpers.
 *
 * Twin Tokens on Stellar are issued as `TWIN<CCY>` credit assets (alphanum4
 * when the currency code is 3 chars, alphanum12 when longer — Stellar
 * supports both). Native XLM is the network's gas/balance asset.
 *
 * These helpers centralize the asset-code conventions so the adapter and
 * settlement modules don't drift.
 */

/** Native XLM asset code. */
export const NATIVE_ASSET_CODE = 'XLM';

/** Issuer sentinel for the native asset — Stellar uses 'native'. */
export const NATIVE_ISSUER = 'native';

/** Prefix applied to every PaySwap-issued twin-token asset code. */
export const TWIN_TOKEN_PREFIX = 'TWIN';

/** Derive the twin-token asset code for a fiat currency. e.g. 'GHS' -> 'TWINGHS'. */
export function twinTokenCode(currency: string): string {
  if (!currency) return '';
  if (currency.startsWith(TWIN_TOKEN_PREFIX)) return currency;
  return `${TWIN_TOKEN_PREFIX}${currency.toUpperCase()}`;
}

/** Strip the TWIN prefix to recover the underlying fiat currency code. */
export function currencyFromTwinToken(code: string): string | undefined {
  if (!isTwinToken(code)) return undefined;
  return code.slice(TWIN_TOKEN_PREFIX.length);
}

/** Native XLM asset descriptor. */
export function nativeAsset(): { code: string; issuer: string; native: true } {
  return { code: NATIVE_ASSET_CODE, issuer: NATIVE_ISSUER, native: true };
}

/** Is this asset code a PaySwap twin token? */
export function isTwinToken(code: string): boolean {
  return typeof code === 'string' && code.startsWith(TWIN_TOKEN_PREFIX) && code.length > TWIN_TOKEN_PREFIX.length;
}

/** Is this the native XLM asset? */
export function isNative(code: string): boolean {
  return code === NATIVE_ASSET_CODE || code === NATIVE_ISSUER;
}

/** Build a unique string key for an asset — used in maps. Native = 'XLM:native'. */
export function assetKey(params: { code: string; issuer?: string }): string {
  const { code, issuer } = params;
  if (isNative(code) || !issuer) return `${code}:${NATIVE_ISSUER}`;
  return `${code}:${issuer}`;
}

/** Static metadata for known asset classes. */
export function assetMetadata(code: string): {
  code: string;
  kind: 'native' | 'twin_token' | 'other_credit';
  alphanum: 4 | 12;
  description: string;
} {
  if (isNative(code)) {
    return { code, kind: 'native', alphanum: 4, description: 'Stellar native XLM' };
  }
  if (isTwinToken(code)) {
    const ccy = currencyFromTwinToken(code);
    return {
      code,
      kind: 'twin_token',
      alphanum: 4,
      description: `PaySwap twin token for ${ccy} — 1:1 backed by ${ccy} fiat reserves`,
    };
  }
  return {
    code,
    kind: 'other_credit',
    alphanum: code.length <= 4 ? 4 : 12,
    description: 'Third-party Stellar credit asset',
  };
}

/** Stellar asset type label as Horizon returns it. */
export function horizonAssetType(code: string): 'native' | 'credit_alphanum4' | 'credit_alphanum12' {
  if (isNative(code)) return 'native';
  return code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12';
}

/**
 * Build a Stellar asset descriptor. Test + integration helper.
 * If `issuer` is omitted and `code` is native ('XLM'/'native'), the returned
 * asset is marked native. Otherwise the issuer is carried as-is.
 */
export function makeAsset(
  code: string,
  issuer?: string,
): { code: string; issuer?: string; native?: boolean } {
  if (isNative(code)) {
    return { code: NATIVE_ASSET_CODE, issuer: NATIVE_ISSUER, native: true };
  }
  return { code, issuer };
}
