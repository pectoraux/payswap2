#!/usr/bin/env bash
# =============================================================================
# PaySwap — Deploy to a Kubernetes cluster
# =============================================================================
# Wraps `helm upgrade --install` with sensible defaults + a post-deploy
# health check. Supports blue-green, canary, and rolling strategies via
# the --strategy flag (delegates to the appropriate CI/CD script).
#
# Usage:
#   bash deploy/scripts/deploy.sh \
#     --environment production \
#     --image-tag v1.2.3 \
#     --strategy blue_green      # or canary, rolling (default: rolling)
#     --namespace payswap
# =============================================================================
set -euo pipefail

ENVIRONMENT="production"
IMAGE_TAG=""
STRATEGY="rolling"
NAMESPACE="payswap"
CHART="deploy/helm"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --image-tag) IMAGE_TAG="$2"; shift 2 ;;
    --strategy) STRATEGY="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --chart) CHART="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: $0 --environment <env> --image-tag <tag> [--strategy <strategy>] [--namespace <ns>]"
      echo "  strategies: rolling (default), blue_green, canary"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$IMAGE_TAG" ]]; then
  echo "❌ --image-tag is required" >&2
  exit 1
fi

case "$STRATEGY" in
  blue_green|canary|rolling) ;;
  *) echo "❌ --strategy must be one of: rolling, blue_green, canary" >&2; exit 1 ;;
esac

echo "🚀 deploying PaySwap"
echo "   environment : $ENVIRONMENT"
echo "   image tag   : $IMAGE_TAG"
echo "   strategy    : $STRATEGY"
echo "   namespace   : $NAMESPACE"
echo ""

if $DRY_RUN; then
  echo "dry-run — would deploy $IMAGE_TAG to $NAMESPACE using $STRATEGY"
  exit 0
fi

# Delegate to the strategy-specific script.
case "$STRATEGY" in
  blue_green)
    exec bash "$(dirname "$0")/../cicd/blue-green.yml" \
      --environment "$ENVIRONMENT" \
      --image-tag "$IMAGE_TAG" \
      --namespace "$NAMESPACE"
    ;;
  canary)
    exec bash "$(dirname "$0")/../cicd/canary.yml" \
      --environment "$ENVIRONMENT" \
      --image-tag "$IMAGE_TAG" \
      --namespace "$NAMESPACE"
    ;;
  rolling)
    # Helm upgrade with a rolling-update strategy.
    VALUES_FILE="deploy/helm/values.${ENVIRONMENT}.yaml"
    HELM_ARGS=(--set "image.tag=${IMAGE_TAG}")
    if [[ -f "$VALUES_FILE" ]]; then
      HELM_ARGS+=(-f "$VALUES_FILE")
    fi

    echo "📦 helm upgrade --install payswap $CHART (tag $IMAGE_TAG)"
    helm upgrade --install payswap "$CHART" \
      --namespace "$NAMESPACE" \
      --create-namespace \
      "${HELM_ARGS[@]}"

    echo "⏳ waiting for rollout"
    kubectl -n "$NAMESPACE" rollout status deployment/payswap-api --timeout=300s
    ;;
esac

# Post-deploy health check.
echo ""
echo "🩺 post-deploy health check"
bash "$(dirname "$0")/health-check.sh" "https://api.${ENVIRONMENT}.payswap.io"

echo ""
echo "✅ deployment complete"
