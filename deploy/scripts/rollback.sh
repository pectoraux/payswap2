#!/usr/bin/env bash
# =============================================================================
# PaySwap — Rollback a deployment
# =============================================================================
# Reverts the most recent deployment for the given environment. For
# blue-green, this flips the service selector back to the previous
# environment. For canary, this drops the canary traffic to 0% and
# scales the canary deployment to 0. For rolling, this reverts to the
# previous Helm release.
#
# Usage:
#   bash deploy/scripts/rollback.sh \
#     --environment production \
#     --namespace payswap \
#     --strategy blue_green      # or canary, rolling (auto-detected if omitted)
# =============================================================================
set -euo pipefail

ENVIRONMENT="production"
NAMESPACE="payswap"
STRATEGY=""
SERVICE_NAME="payswap-api"
RELEASE_NAME="payswap"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --strategy) STRATEGY="$2"; shift 2 ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --release) RELEASE_NAME="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --environment <env> [--namespace <ns>] [--strategy <strategy>]"
      echo "  strategies: blue_green, canary, rolling"
      echo "  if --strategy is omitted, auto-detected from the service annotations"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

echo "↩️  rolling back PaySwap"
echo "   environment : $ENVIRONMENT"
echo "   namespace   : $NAMESPACE"
echo ""

# Auto-detect strategy if not specified.
if [[ -z "$STRATEGY" ]]; then
  LIVE_ENV=$(kubectl -n "$NAMESPACE" get svc "$SERVICE_NAME" \
    -o jsonpath='{.metadata.annotations.deployment\.payswap\.io/live-environment}' 2>/dev/null || echo "")
  PREV_ENV=$(kubectl -n "$NAMESPACE" get svc "$SERVICE_NAME" \
    -o jsonpath='{.metadata.annotations.deployment\.payswap\.io/previous-environment}' 2>/dev/null || echo "")
  if [[ -n "$LIVE_ENV" && -n "$PREV_ENV" ]]; then
    STRATEGY="blue_green"
  elif kubectl -n "$NAMESPACE" get deployment "${SERVICE_NAME}-canary" > /dev/null 2>&1; then
    STRATEGY="canary"
  else
    STRATEGY="rolling"
  fi
  echo "   strategy    : $STRATEGY (auto-detected)"
fi

case "$STRATEGY" in
  blue_green)
    LIVE_ENV=$(kubectl -n "$NAMESPACE" get svc "$SERVICE_NAME" \
      -o jsonpath='{.metadata.annotations.deployment\.payswap\.io/live-environment}' 2>/dev/null || echo "blue")
    PREV_ENV=$(kubectl -n "$NAMESPACE" get svc "$SERVICE_NAME" \
      -o jsonpath='{.metadata.annotations.deployment\.payswap\.io/previous-environment}' 2>/dev/null || echo "green")

    if [[ "$LIVE_ENV" == "$PREV_ENV" ]]; then
      echo "❌ no previous environment to roll back to (live == previous == $LIVE_ENV)" >&2
      exit 1
    fi

    echo "🔀 flipping service selector back from $LIVE_ENV to $PREV_ENV"
    kubectl -n "$NAMESPACE" patch svc "$SERVICE_NAME" --type=json \
      -p="[{\"op\":\"replace\",\"path\":\"/spec/selector\",\"value\":{\"app\":\"${SERVICE_NAME}-${PREV_ENV}\"}}]"
    kubectl -n "$NAMESPACE" annotate svc "$SERVICE_NAME" \
      "deployment.payswap.io/live-environment=${PREV_ENV}" \
      "deployment.payswap.io/previous-environment=${LIVE_ENV}" \
      "deployment.payswap.io/last-flip-at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "deployment.payswap.io/last-rollback-at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --overwrite
    echo "✅ rolled back to $PREV_ENV"
    ;;

  canary)
    CANARY_DEPLOYMENT="${SERVICE_NAME}-canary"
    echo "📉 dropping canary traffic to 0%"
    kubectl -n "$NAMESPACE" annotate ingress "$SERVICE_NAME" \
      "nginx.ingress.kubernetes.io/canary-weight=0" --overwrite
    kubectl -n "$NAMESPACE" scale "deployment/${CANARY_DEPLOYMENT}" --replicas=0 2>/dev/null || true
    echo "✅ canary traffic dropped, canary deployment scaled to 0"
    ;;

  rolling)
    echo "⏮️  reverting to previous Helm release"
    helm -n "$NAMESPACE" rollback "$RELEASE_NAME" || {
      echo "❌ helm rollback failed — no previous release available" >&2
      exit 1
    }
    kubectl -n "$NAMESPACE" rollout status deployment/payswap-api --timeout=300s
    echo "✅ reverted to previous Helm release"
    ;;

  *)
    echo "❌ unknown strategy: $STRATEGY" >&2
    exit 1
    ;;
esac

echo ""
echo "🩺 post-rollback health check"
bash "$(dirname "$0")/health-check.sh" "https://api.${ENVIRONMENT}.payswap.io"

echo ""
echo "✅ rollback complete"
