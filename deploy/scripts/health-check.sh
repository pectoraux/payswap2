#!/usr/bin/env bash
# =============================================================================
# PaySwap — Post-deployment health check
# =============================================================================
# Hits the /healthz, /readyz, and /startupz endpoints of the deployed
# PaySwap instance + a smoke-test request to /api/ops/health. Exits 0
# if all pass, 1 otherwise. Used by CI/CD after a deploy or rollback.
#
# Usage:
#   bash deploy/scripts/health-check.sh https://api.payswap.io
#   bash deploy/scripts/health-check.sh http://localhost:3000
# =============================================================================
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
TIMEOUT="${HEALTH_CHECK_TIMEOUT:-30}"   # seconds per probe
RETRY_INTERVAL="${HEALTH_CHECK_RETRY_INTERVAL:-2}"

if [[ ! "$BASE_URL" =~ ^https?:// ]]; then
  echo "❌ invalid base URL: $BASE_URL (must start with http:// or https://)" >&2
  exit 1
fi

echo "🩺 health check — $BASE_URL"

# Probe a URL with retries. Exits 1 if the URL never returns 2xx within
# the per-probe timeout.
probe() {
  local path="$1"
  local label="$2"
  local url="${BASE_URL}${path}"
  local elapsed=0

  echo "   probing $label → $path"
  while [[ "$elapsed" -lt "$TIMEOUT" ]]; do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")
    if [[ "$code" =~ ^2 ]]; then
      echo "      ✅ $label OK ($code in ${elapsed}s)"
      return 0
    fi
    echo "      … $label returned $code, retrying in ${RETRY_INTERVAL}s"
    sleep "$RETRY_INTERVAL"
    elapsed=$((elapsed + RETRY_INTERVAL))
  done

  echo "      ❌ $label failed after ${TIMEOUT}s"
  return 1
}

# Smoke-test an API endpoint that exercises the kernel + persistence.
probe_api() {
  local path="$1"
  local label="$2"
  local url="${BASE_URL}${path}"
  echo "   smoke-testing $label → $path"
  local body
  if body=$(curl -sf --max-time 10 "$url" 2>/dev/null); then
    echo "      ✅ $label OK"
    return 0
  else
    echo "      ❌ $label failed"
    return 1
  fi
}

FAIL=0

# Kubernetes-style probes.
probe /healthz liveness  || FAIL=1
probe /readyz  readiness || FAIL=1
probe /startupz startup  || FAIL=1

# API smoke tests (only if the probes passed).
if [[ "$FAIL" -eq 0 ]]; then
  probe_api /api/ops/health "ops health"     || FAIL=1
  probe_api /api/ops/overview "ops overview" || FAIL=1
  probe_api /api/treasury/status "treasury status" || FAIL=1
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "❌ health check FAILED"
  exit 1
fi

echo ""
echo "✅ all health checks passed"
exit 0
