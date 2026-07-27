#!/usr/bin/env bash
# =============================================================================
# PaySwap — Seed production data (carefully)
# =============================================================================
# Seeds a freshly-deployed PaySwap production instance with the
# minimum-viable bootstrap data:
#   - The system admin merchant + user
#   - The default corridors (KE→GH, KE→NG, KE→US, etc.)
#   - The default liquidity providers
#   - The default compliance rules
#   - The treasury opening balances
#
# This script is DESTRUCTIVE — it will refuse to run against an
# environment that already has data unless --force is passed. It is
# idempotent (re-running it with --force is safe).
#
# Usage:
#   bash deploy/scripts/seed-production.sh \
#     --environment production \
#     --base-url https://api.payswap.io \
#     --admin-token "$ADMIN_JWT"
#
# Requires:
#   - curl, jq
#   - an admin JWT with the `system:admin` scope
# =============================================================================
set -euo pipefail

ENVIRONMENT=""
BASE_URL=""
ADMIN_TOKEN=""
FORCE=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --admin-token) ADMIN_TOKEN="$2"; shift 2 ;;
    --force) FORCE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: $0 --environment <env> --base-url <url> --admin-token <jwt> [--force] [--dry-run]"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$ENVIRONMENT" ]] || { echo "❌ --environment is required" >&2; exit 1; }
[[ -n "$BASE_URL"   ]] || { echo "❌ --base-url is required" >&2; exit 1; }
[[ -n "$ADMIN_TOKEN" ]] || { echo "❌ --admin-token is required" >&2; exit 1; }

echo "🌱 seeding PaySwap production data"
echo "   environment : $ENVIRONMENT"
echo "   base URL    : $BASE_URL"
echo "   force       : $FORCE"
echo "   dry-run     : $DRY_RUN"
echo ""

# Sanity: refuse to seed production without --force.
if [[ "$ENVIRONMENT" == "production" && "$FORCE" == false ]]; then
  echo "❌ refusing to seed production without --force" >&2
  echo "   re-run with --force to confirm you want to seed production" >&2
  exit 1
fi

curl_auth() {
  curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" \
       -H "Content-Type: application/json" "$@"
}

# Step 1 — check if the environment is already seeded.
echo "🔎 checking if $ENVIRONMENT is already seeded"
EXISTING_MERCHANTS=$(curl_auth "${BASE_URL}/api/merchant/state" 2>/dev/null | jq '.total // 0' || echo "0")
echo "   existing merchants: $EXISTING_MERCHANTS"

if [[ "$EXISTING_MERCHANTS" -gt 0 && "$FORCE" == false ]]; then
  echo "❌ environment already has $EXISTING_MERCHANTS merchants — refusing to seed"
  echo "   re-run with --force to seed anyway (idempotent)" >&2
  exit 1
fi

if $DRY_RUN; then
  echo ""
  echo "dry-run — would seed:"
  echo "   - 1 admin merchant (payswap-admin)"
  echo "   - 7 default corridors (KE→GH, KE→NG, KE→US, KE→ZA, KE→UG, KE→TZ, US→KE)"
  echo "   - 5 default liquidity providers"
  echo "   - compliance rule set v1 (AML + sanctions + KYC + travel-rule)"
  echo "   - treasury opening balances (USD 1,000,000 reserve)"
  exit 0
fi

# Step 2 — bootstrap the admin merchant.
echo ""
echo "📦 bootstrapping admin merchant"
curl_auth -X POST "${BASE_URL}/api/merchant/onboard" \
  -d '{
    "name": "PaySwap Admin",
    "email": "admin@payswap.io",
    "country": "Kenya",
    "currency": "KES",
    "tier": "platinum",
    "role": "system:admin"
  }' | jq .

# Step 3 — register default corridors.
echo ""
echo "📦 registering default corridors"
DEFAULT_CORRIDORS=(
  '{"from":"Kenya","to":"Ghana","fromCurrency":"KES","toCurrency":"GHS"}'
  '{"from":"Kenya","to":"Nigeria","fromCurrency":"KES","toCurrency":"NGN"}'
  '{"from":"Kenya","to":"United States","fromCurrency":"KES","toCurrency":"USD"}'
  '{"from":"Kenya","to":"South Africa","fromCurrency":"KES","toCurrency":"ZAR"}'
  '{"from":"Kenya","to":"Uganda","fromCurrency":"KES","toCurrency":"UGX"}'
  '{"from":"Kenya","to":"Tanzania","fromCurrency":"KES","toCurrency":"TZS"}'
  '{"from":"United States","to":"Kenya","fromCurrency":"USD","toCurrency":"KES"}'
)
for corridor in "${DEFAULT_CORRIDORS[@]}"; do
  echo "   corridor: $(echo "$corridor" | jq -c '.from + " → " + .to')"
  curl_auth -X POST "${BASE_URL}/api/protocol" -d "$corridor" > /dev/null
done

# Step 4 — register default liquidity providers.
echo ""
echo "📦 registering default liquidity providers"
DEFAULT_LPS=(
  '{"name":"LP-Mpesa-KE","country":"Kenya","capacityUsd":500000}'
  '{"name":"LP-Stellar-Global","country":"United States","capacityUsd":2000000}'
  '{"name":"LP-Bank-GH","country":"Ghana","capacityUsd":300000}'
  '{"name":"LP-Bank-NG","country":"Nigeria","capacityUsd":400000}'
  '{"name":"LP-Bank-ZA","country":"South Africa","capacityUsd":350000}'
)
for lp in "${DEFAULT_LPS[@]}"; do
  echo "   LP: $(echo "$lp" | jq -c '.name')"
  curl_auth -X POST "${BASE_URL}/api/protocol" -d "$lp" > /dev/null
done

# Step 5 — seed compliance rules.
echo ""
echo "📦 seeding compliance rule set v1"
curl_auth -X POST "${BASE_URL}/api/protocol" \
  -d '{"action":"seed_compliance","version":"v1"}' > /dev/null
echo "   AML + sanctions + KYC + travel-rule rules seeded"

# Step 6 — seed treasury opening balances.
echo ""
echo "📦 seeding treasury opening balances"
curl_auth -X POST "${BASE_URL}/api/treasury/status" \
  -d '{"action":"opening_balances","reserveUsd":1000000}' > /dev/null
echo "   USD 1,000,000 reserve posted"

# Step 7 — verify by re-fetching counts.
echo ""
echo "✅ seeding complete"
echo "   verifying..."
FINAL_MERCHANTS=$(curl_auth "${BASE_URL}/api/merchant/state" | jq '.total // 0')
echo "   merchants now: $FINAL_MERCHANTS"

echo ""
echo "🩺 post-seed health check"
bash "$(dirname "$0")/health-check.sh" "$BASE_URL"

exit 0
