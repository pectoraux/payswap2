# @payswap/cli

The official command-line interface for the PaySwap API. Inspect payments,
kick off payouts, peek at the ledger, run compliance screening, and check
system health — all from your terminal.

## Install

```bash
npm install -g @payswap/cli
# or
bun add -g @payswap/cli
```

Or run it directly with `bunx`:

```bash
bunx @payswap/cli ops health
```

## Configure

Set your API key either via an environment variable or via the `config`
command. Env vars take precedence over the config file.

```bash
# Option 1 — env var (great for CI).
export PAYSWAP_API_KEY=psk_live_abc123...

# Option 2 — config file at ~/.payswap/config.json
payswap config set apiKey psk_live_abc123...
payswap config set baseUrl https://api.sandbox.payswap.io/v1
payswap config show
```

| Key        | Env var              | Default                          |
|------------|----------------------|----------------------------------|
| `apiKey`   | `PAYSWAP_API_KEY`    | — (required)                     |
| `baseUrl`  | `PAYSWAP_BASE_URL`   | `https://api.payswap.io/v1`      |
| `timeout`  | `PAYSWAP_TIMEOUT`    | `30000`                          |

## Usage

```
payswap <command> <subcommand> [flags]
```

### Payments

```bash
# List payments (default: 25 per page).
payswap payments list
payswap payments list --limit 50 --format table

# Get a single payment.
payswap payments get pay_01HZX...
```

### Payouts

```bash
# Create a payout to an M-Pesa phone.
payswap payouts create \
  --amount 5000 \
  --currency KES \
  --phone +254700000001 \
  --reference WITHDRAWAL-001

# Process (execute) a pending payout.
payswap payouts process po_01HZX...

# List payouts.
payswap payouts list
```

### Merchants

```bash
payswap merchants get
```

### Webhooks

```bash
# List recent webhook deliveries.
payswap webhooks list

# List configured webhook endpoints.
payswap webhooks endpoints
```

### Ledger

```bash
# Show the trial balance.
payswap ledger trial-balance

# Run reconciliation between two timestamps.
payswap ledger reconciliation --from 1735000000 --to 1735086400
```

### Ops

```bash
# Health check (no auth required).
payswap ops health

# Prometheus metrics (raw text).
payswap ops metrics

# Operations overview.
payswap ops overview
```

### Compliance

```bash
# Screen an entity against sanctions / PEP / adverse-media lists.
payswap compliance screen "John Doe" --type individual

# Export the compliance audit log.
payswap compliance audit-export
```

### Treasury

```bash
# Treasury status overview.
payswap treasury status

# Detailed positions per currency.
payswap treasury positions
```

### Config

```bash
payswap config set apiKey psk_live_abc123...
payswap config set baseUrl https://api.sandbox.payswap.io/v1
payswap config get apiKey
payswap config show        # shows all settings with the API key masked
```

## Output formats

| Flag              | Description                                    |
|-------------------|------------------------------------------------|
| `--format json`   | Pretty-printed JSON (default).                 |
| `--format table`  | Human-readable table (best for list responses).|
| `--format raw`    | Raw JSON, no indentation (for piping to `jq`).|

Example:

```bash
payswap payments list --format table
# id            object   amount  currency  status     customer         created
# -----------   ------   ------  --------  ------     --------         -------
# pay_01HZX...  payment  2900    KES       succeeded  cust_01HZX...    1735000000
```

## Exit codes

| Code | Meaning                              |
|------|--------------------------------------|
| 0    | Success.                             |
| 1    | Usage error or API error.            |

## Shell completion (optional)

The CLI doesn't ship built-in completion, but because command names are
short and stable, a simple bash alias works well:

```bash
alias ps='payswap'
```

## Programmatic use

The CLI is a thin wrapper around the same `fetch` calls the SDK makes. For
non-interactive use, prefer the SDK (`@payswap/sdk-typescript`).

## Support

- Docs: <https://docs.payswap.io>
- Issues: <https://github.com/payswap/payswap/issues>
- Email: <developers@payswap.io>

## License

MIT © PaySwap
