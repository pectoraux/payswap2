#!/usr/bin/env node
/**
 * PaySwap CLI — command-line interface for the PaySwap API.
 *
 * Uses Node built-ins (`fs`, `path`, `os`) via top-level ESM imports so the
 * file is lintable under `@typescript-eslint/no-require-imports`. The CLI
 * itself uses the global `fetch` available in Node 18+.
 *
 * Usage:
 *   payswap payments list
 *   payswap payments get <id>
 *   payswap payouts create --amount 5000 --currency KES --phone +254700000001
 *   payswap payouts process <id>
 *   payswap merchants get
 *   payswap webhooks list
 *   payswap ledger trial-balance
 *   payswap ledger reconciliation
 *   payswap ops health
 *   payswap ops metrics
 *   payswap compliance screen <entity>
 *   payswap treasury status
 *   payswap config set <key> <value>
 *   payswap config get <key>
 *
 * Configuration:
 *   - API key: read from `PAYSWAP_API_KEY` env var, or `~/.payswap/config`
 *     (set via `payswap config set apiKey <value>`).
 *   - Base URL: read from `PAYSWAP_BASE_URL` env var, or `~/.payswap/config`.
 *     Defaults to `https://api.payswap.io/v1`.
 *
 * Output:
 *   - Default: pretty-printed JSON.
 *   - `--format table`: human-readable table.
 *   - `--format raw`: raw JSON without indentation.
 *
 * Exit codes:
 *   - 0: success.
 *   - 1: usage error / API error.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface CliConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}

const DEFAULT_BASE_URL = 'https://api.payswap.io/v1';
const DEFAULT_TIMEOUT = 30_000;

/** Read config from env + file. Env wins over file. */
function loadConfig(): CliConfig {
  const env = (typeof process !== 'undefined' && process.env) || {};
  const cfg: CliConfig = {
    apiKey: env.PAYSWAP_API_KEY,
    baseUrl: env.PAYSWAP_BASE_URL,
    timeout: env.PAYSWAP_TIMEOUT ? Number(env.PAYSWAP_TIMEOUT) : undefined,
  };
  const file = readConfigFile();
  if (file) {
    cfg.apiKey = cfg.apiKey ?? file.apiKey;
    cfg.baseUrl = cfg.baseUrl ?? file.baseUrl;
    cfg.timeout = cfg.timeout ?? file.timeout;
  }
  cfg.baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
  cfg.timeout = cfg.timeout ?? DEFAULT_TIMEOUT;
  return cfg;
}

/** Read `~/.payswap/config` as JSON. */
function readConfigFile(): CliConfig | undefined {
  try {
    const file = path.join(os.homedir(), '.payswap', 'config.json');
    if (!fs.existsSync(file)) return undefined;
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw) as CliConfig;
  } catch {
    return undefined;
  }
}

/** Write `~/.payswap/config.json` with merged config. */
function writeConfigFile(patch: Partial<CliConfig>): void {
  const dir = path.join(os.homedir(), '.payswap');
  const file = path.join(dir, 'config.json');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const existing = readConfigFile() ?? {};
  const merged = { ...existing, ...patch };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** Minimal argv parser: `--flag value`, `--flag=value`, `--bool`. */
function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          flags[a.slice(2)] = true;
        } else {
          flags[a.slice(2)] = next;
          i += 1;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ---------------------------------------------------------------------------
// API client (tiny, no SDK dependency)
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<unknown> {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'No API key set. Run `payswap config set apiKey <value>` or set PAYSWAP_API_KEY.',
    );
  }
  const qs = query
    ? '?' +
      Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const url = `${cfg.baseUrl!.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}${qs}`;
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), cfg.timeout)
    : null;
  try {
    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': '@payswap/cli/1.0.0',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
    const text = await resp.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!resp.ok) {
      const msg =
        parsed && typeof parsed === 'object' && 'error' in (parsed as object)
          ? ((parsed as { error: { message?: string } }).error.message ?? `HTTP ${resp.status}`)
          : `HTTP ${resp.status}`;
      throw new ApiError(resp.status, parsed, msg);
    }
    return parsed;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function output(value: unknown, format: string): void {
  if (format === 'raw') {
    process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
    process.stdout.write('\n');
    return;
  }
  if (format === 'table') {
    outputTable(value);
    return;
  }
  // Default: pretty JSON.
  process.stdout.write(JSON.stringify(value, null, 2));
  process.stdout.write('\n');
}

function outputTable(value: unknown): void {
  if (value && typeof value === 'object' && 'data' in (value as object)) {
    const list = (value as { data: unknown[] }).data;
    if (Array.isArray(list)) {
      printRows(list as Record<string, unknown>[]);
      return;
    }
  }
  if (Array.isArray(value)) {
    printRows(value as Record<string, unknown>[]);
    return;
  }
  // Fallback to JSON for objects that aren't lists.
  process.stdout.write(JSON.stringify(value, null, 2));
  process.stdout.write('\n');
}

function printRows(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    process.stdout.write('(no rows)\n');
    return;
  }
  const cols = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      for (const k of Object.keys(r)) acc.add(k);
      return acc;
    }, new Set()),
  ).slice(0, 8); // cap columns to keep table readable
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  process.stdout.write(header + '\n');
  process.stdout.write(widths.map((w) => '-'.repeat(w)).join('  ') + '\n');
  for (const r of rows) {
    process.stdout.write(cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  ') + '\n');
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function cmdPayments(args: ParsedArgs): Promise<unknown> {
  const sub = args.positional[0];
  if (sub === 'list') {
    return apiRequest('GET', '/payments', undefined, {
      limit: args.flags.limit ? Number(args.flags.limit) : undefined,
    });
  }
  if (sub === 'get') {
    const id = args.positional[1];
    if (!id) throw new Error('usage: payswap payments get <id>');
    return apiRequest('GET', `/payments/${encodeURIComponent(id)}`);
  }
  throw new Error(`unknown payments subcommand: ${sub ?? '(none)'}`);
}

async function cmdPayouts(args: ParsedArgs): Promise<unknown> {
  const sub = args.positional[0];
  if (sub === 'create') {
    const amount = args.flags.amount ? Number(args.flags.amount) : undefined;
    const currency = args.flags.currency as string | undefined;
    const phone = args.flags.phone as string | undefined;
    const account = args.flags.account as string | undefined;
    const chain = args.flags.chain as string | undefined;
    if (!amount || !currency) {
      throw new Error('usage: payswap payouts create --amount <n> --currency <c> [--phone | --account | --address] [--chain]');
    }
    const destination: Record<string, unknown> = {};
    if (phone) { destination.type = 'mpesa'; destination.phone = phone; }
    else if (account) { destination.type = 'bank'; destination.account = account; }
    else if (args.flags.address) { destination.type = 'crypto'; destination.address = args.flags.address; if (chain) destination.chain = chain; }
    else throw new Error('one of --phone, --account, --address is required');
    return apiRequest('POST', '/payouts', {
      amount,
      currency,
      destination,
      reference: args.flags.reference as string | undefined,
    });
  }
  if (sub === 'process') {
    const id = args.positional[1];
    if (!id) throw new Error('usage: payswap payouts process <id>');
    return apiRequest('POST', `/payouts/${encodeURIComponent(id)}/process`);
  }
  if (sub === 'list') {
    return apiRequest('GET', '/payouts', undefined, {
      limit: args.flags.limit ? Number(args.flags.limit) : undefined,
    });
  }
  throw new Error(`unknown payouts subcommand: ${sub ?? '(none)'}`);
}

async function cmdMerchants(args: ParsedArgs): Promise<unknown> {
  const sub = args.positional[0];
  if (sub === 'get') return apiRequest('GET', '/merchants/me');
  throw new Error(`unknown merchants subcommand: ${sub ?? '(none)'}`);
}

async function cmdWebhooks(args: ParsedArgs): Promise<unknown> {
  const sub = args.positional[0];
  if (sub === 'list') return apiRequest('GET', '/webhooks/deliveries');
  if (sub === 'endpoints') return apiRequest('GET', '/webhooks/endpoints');
  throw new Error(`unknown webhooks subcommand: ${sub ?? '(none)'}`);
}

async function cmdLedger(args: ParsedArgs): Promise<unknown> {
  const sub = args.positional[0];
  if (sub === 'trial-balance') return apiRequest('GET', '/ledger/trial-balance');
  if (sub === 'reconciliation') return apiRequest('POST', '/ledger/reconciliation', {
    from: args.flags.from ? Number(args.flags.from) : undefined,
    to: args.flags.to ? Number(args.flags.to) : undefined,
  });
  throw new Error(`unknown ledger subcommand: ${sub ?? '(none)'}`);
}

async function cmdOps(args: ParsedArgs): Promise<unknown> {
  const sub = args.positional[0];
  if (sub === 'health') return apiRequest('GET', '/ops/health');
  if (sub === 'metrics') {
    const cfg = loadConfig();
    const url = `${cfg.baseUrl!.replace(/\/$/, '')}/ops/metrics`;
    const resp = await fetch(url);
    return resp.text();
  }
  if (sub === 'overview') return apiRequest('GET', '/ops/overview');
  throw new Error(`unknown ops subcommand: ${sub ?? '(none)'}`);
}

async function cmdCompliance(args: ParsedArgs): Promise<unknown> {
  const sub = args.positional[0];
  if (sub === 'screen') {
    const entity = args.positional[1];
    if (!entity) throw new Error('usage: payswap compliance screen <entity>');
    return apiRequest('POST', '/compliance/screen', {
      entity: { name: entity, type: args.flags.type ?? 'individual' },
      lists: ['ofac', 'eu', 'un', 'uk_hmt', 'pep', 'adverse_media'],
    });
  }
  if (sub === 'audit-export') return apiRequest('GET', '/compliance/audit-export');
  throw new Error(`unknown compliance subcommand: ${sub ?? '(none)'}`);
}

async function cmdTreasury(args: ParsedArgs): Promise<unknown> {
  const sub = args.positional[0];
  if (sub === 'status') return apiRequest('GET', '/treasury/status');
  if (sub === 'positions') return apiRequest('GET', '/treasury/positions');
  throw new Error(`unknown treasury subcommand: ${sub ?? '(none)'}`);
}

async function cmdConfig(args: ParsedArgs): Promise<unknown> {
  const sub = args.positional[0];
  if (sub === 'set') {
    const key = args.positional[1];
    const value = args.positional[2];
    if (!key || value === undefined) throw new Error('usage: payswap config set <key> <value>');
    const patch: Partial<CliConfig> = {};
    if (key === 'apiKey' || key === 'baseUrl') {
      patch[key] = String(value);
    } else if (key === 'timeout') {
      patch.timeout = Number(value);
    } else {
      throw new Error(`unknown config key: ${key}`);
    }
    writeConfigFile(patch);
    return { ok: true, key, value };
  }
  if (sub === 'get') {
    const key = args.positional[1];
    if (!key) throw new Error('usage: payswap config get <key>');
    const cfg = loadConfig();
    return { key, value: (cfg as Record<string, unknown>)[key] ?? null };
  }
  if (sub === 'show') {
    const cfg = loadConfig();
    // Mask the API key.
    const masked = cfg.apiKey
      ? `${cfg.apiKey.slice(0, 12)}...${cfg.apiKey.slice(-4)}`
      : null;
    return { ...cfg, apiKey: masked };
  }
  throw new Error(`unknown config subcommand: ${sub ?? '(none)'}`);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const COMMANDS: Record<string, (args: ParsedArgs) => Promise<unknown>> = {
  payments: cmdPayments,
  payouts: cmdPayouts,
  merchants: cmdMerchants,
  webhooks: cmdWebhooks,
  ledger: cmdLedger,
  ops: cmdOps,
  compliance: cmdCompliance,
  treasury: cmdTreasury,
  config: cmdConfig,
};

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const format = (args.flags.format as string) ?? 'json';

  if (args.positional.length === 0 || args.flags.help || args.flags.h) {
    printHelp();
    return 0;
  }
  if (args.flags.version || args.flags.v) {
    process.stdout.write('@payswap/cli/1.0.0\n');
    return 0;
  }

  const cmd = args.positional[0];
  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write(`unknown command: ${cmd}\n`);
    printHelp();
    return 1;
  }
  // Pass the rest of the positional args to the handler (drop the command name).
  const subArgs: ParsedArgs = {
    positional: args.positional.slice(1),
    flags: args.flags,
  };
  try {
    const result = await handler(subArgs);
    output(result, format);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${msg}\n`);
    if (err instanceof ApiError) {
      process.stderr.write(`status: ${err.status}\n`);
      if (err.body) process.stderr.write(`body: ${JSON.stringify(err.body)}\n`);
    }
    return 1;
  }
}

function printHelp(): void {
  process.stdout.write(`PaySwap CLI — interact with the PaySwap API.

Usage:
  payswap <command> <subcommand> [flags]

Commands:
  payments list | get <id>
  payouts create --amount <n> --currency <c> [--phone | --account | --address] [--chain <c>]
  payouts process <id> | list
  merchants get
  webhooks list | endpoints
  ledger trial-balance | reconciliation [--from <ts>] [--to <ts>]
  ops health | metrics | overview
  compliance screen <entity> [--type individual|entity]
  treasury status | positions
  config set <key> <value>   (keys: apiKey, baseUrl, timeout)
  config get <key> | show

Flags:
  --format <json|table|raw>   Output format (default: json).
  --limit <n>                 Page size for list endpoints.
  --help, -h                  Show this help.
  --version, -v               Show CLI version.

Configuration:
  - PAYSWAP_API_KEY env var, or \`~/.payswap/config.json\` (set via \`config set\`).
  - PAYSWAP_BASE_URL env var, or \`~/.payswap/config.json\`.
  - Default base URL: ${DEFAULT_BASE_URL}.
`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Skip the `node` binary + script path.
const cliArgv = (typeof process !== 'undefined' && process.argv.slice(2)) || [];
main(cliArgv)
  .then((code) => {
    if (typeof process !== 'undefined') process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    if (typeof process !== 'undefined') process.exit(1);
  });
