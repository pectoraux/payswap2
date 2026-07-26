# PaySwap — Production Deployment Guide

This directory contains everything needed to deploy PaySwap to production:

- **Docker** — multi-stage build + dev/CI compose
- **Kubernetes** — namespace, deployment, service, ingress, HPA, PDB, configmap, secret
- **Helm** — parameterised chart for one-command deploys
- **Terraform** — full AWS IaC (VPC, EKS, RDS, S3, CloudFront, Route 53)
- **CI/CD** — GitHub Actions workflow + blue-green + canary scripts
- **Scripts** — deploy, rollback, health-check, seed-production
- **Protocol layer** — `src/protocol/deployment/` (feature flags, secret management, autoscaling, deployment strategies, health probes, monitoring)

## Architecture Overview

```
                          ┌──────────────────────────────┐
                          │       Route 53 (DNS)         │
                          │   api.payswap.io  ─────────┐ │
                          │   dashboard.payswap.io ──┐ │ │
                          └──────────────────────────┼─┼─┘
                                                      │ │
                          ┌──────────────────────────▼─▼─┐
                          │     CloudFront + WAF (CDN)   │
                          │   (TLS termination, caching) │
                          └──────────────┬───────────────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │    ALB (nginx ingress)        │
                          │   payswap-api Service (K8s)   │
                          └───────────────┬───────────────┘
                                          │
        ┌─────────────────────────────────┴──────────────────────────────┐
        │                       EKS Cluster (3 AZs)                      │
        │  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
        │  │ payswap-api │  │ settlement-wkr  │  │ webhook-dispatcher  │ │
        │  │  (Next.js)  │  │   (worker)      │  │     (worker)        │ │
        │  │  2-20 pods  │  │   1-10 pods     │  │     1-5 pods        │ │
        │  └──────┬──────┘  └────────┬────────┘  └──────────┬──────────┘ │
        │         │                  │                      │            │
        │  ┌──────▼──────────────────▼──────────────────────▼──────────┐ │
        │  │              HPA (CPU + memory + custom rps)              │ │
        │  └──────────────────────────────────────────────────────────┘ │
        └─────────────────────────────┬──────────────────────────────────┘
                                       │
              ┌────────────────────────┼─────────────────────────┐
              │                        │                         │
       ┌──────▼──────┐         ┌───────▼───────┐         ┌──────▼──────┐
       │  RDS        │         │  ElastiCache  │         │  S3         │
       │ PostgreSQL  │         │  Redis        │         │ (backups +  │
       │ Multi-AZ    │         │  (cache)      │         │  assets)    │
       └─────────────┘         └───────────────┘         └─────────────┘
```

## Quickstart — Local Development

```bash
# Bring up the full stack (app + Postgres + Redis) via Docker Compose.
docker compose -f deploy/docker/docker-compose.yml up --build

# In another terminal, verify health.
bash deploy/scripts/health-check.sh http://localhost:3000
```

## Quickstart — Production Deploy

### 1. Provision infrastructure (Terraform, one-time)

```bash
cd deploy/terraform

# Configure your AWS credentials + S3 backend (edit main.tf).
terraform init
terraform plan -var-file=production.tfvars
terraform apply -var-file=production.tfvars

# Note the outputs (cluster endpoint, RDS endpoint, ECR URL).
terraform output
```

### 2. Configure kubectl

```bash
aws eks update-kubeconfig \
  --name payswap-production-cluster \
  --region us-east-1
```

### 3. Build + push the Docker image

```bash
# From the repo root.
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker build -f deploy/docker/Dockerfile -t payswap/api:v1.0.0 .
docker tag payswap/api:v1.0.0 \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/payswap/api:v1.0.0
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/payswap/api:v1.0.0
```

### 4. Deploy via Helm

```bash
# Install / upgrade the Helm release.
helm upgrade --install payswap deploy/helm \
  --namespace payswap \
  --create-namespace \
  --set image.repository=<account-id>.dkr.ecr.us-east-1.amazonaws.com/payswap/api \
  --set image.tag=v1.0.0 \
  -f deploy/helm/values.yaml

# Wait for the rollout to complete.
kubectl -n payswap rollout status deployment/payswap-api --timeout=300s

# Post-deploy health check.
bash deploy/scripts/health-check.sh https://api.payswap.io
```

### 5. Seed production data (carefully)

```bash
# Get an admin JWT first (via the auth flow), then:
ADMIN_JWT=eyJ... bash deploy/scripts/seed-production.sh \
  --environment production \
  --base-url https://api.payswap.io \
  --admin-token "$ADMIN_JWT" \
  --force
```

## Deployment Strategies

PaySwap supports three deployment strategies, exposed via the
`DeploymentService` class in `src/protocol/deployment/deployment-strategy.ts`
and wired into the CI/CD scripts:

### Blue-Green (`deploy/cicd/blue-green.yml`)

- Two identical environments (`blue` and `green`) run side by side.
- The new version is deployed to the inactive environment.
- Once healthy, the Service selector is flipped atomically.
- The previous environment is kept running for instant rollback.

```bash
bash deploy/cicd/blue-green.yml \
  --environment production \
  --image-tag v1.2.3 \
  --namespace payswap \
  --service payswap-api \
  --soak-minutes 60
```

### Canary (`deploy/cicd/canary.yml`)

- The new version receives 5% → 25% → 50% → 100% of traffic in stages.
- Each stage soaks for 5 minutes while Prometheus monitors the error rate.
- If the canary error rate exceeds 2%, the canary is automatically rolled back.

```bash
bash deploy/cicd/canary.yml \
  --environment production \
  --image-tag v1.2.3 \
  --namespace payswap \
  --service payswap-api \
  --prometheus-url http://prometheus.monitoring:9090
```

### Rolling (default)

- The Helm `strategy: RollingUpdate` replaces pods one batch at a time
  (`maxUnavailable: 1`, `maxSurge: 1`).
- PDB (`minAvailable: 2`) ensures at least 2 pods are always serving.

```bash
bash deploy/scripts/deploy.sh \
  --environment production \
  --image-tag v1.2.3 \
  --strategy rolling
```

## Rollback

```bash
# Auto-detect the strategy + revert.
bash deploy/scripts/rollback.sh --environment production

# Or specify the strategy explicitly.
bash deploy/scripts/rollback.sh --environment production --strategy blue_green
bash deploy/scripts/rollback.sh --environment production --strategy canary
bash deploy/scripts/rollback.sh --environment production --strategy rolling
```

## Feature Flags

Feature flags live in `src/protocol/deployment/feature-flags.ts`. Six
flags ship by default:

| Flag                       | Default | Description                                       |
| -------------------------- | ------- | ------------------------------------------------- |
| `live_stellar`             | off     | Switch Stellar adapter to mainnet.                |
| `real_connectors`          | off     | Switch production connectors to live mode.        |
| `multi_region`             | off     | Enable multi-region active-active replication.    |
| `compliance_enforcement`   | on      | Enforce AML / sanctions / KYC / travel-rule.      |
| `treasury_gates`           | on      | Enforce pre-mint / pre-burn / backing gates.      |
| `advanced_analytics`       | on      | Enable distributed tracing + analytics.           |

Runtime usage:

```ts
import { featureFlags } from '@/protocol/deployment';

if (featureFlags.isEnabled('live_stellar', merchantId)) {
  // Use Stellar mainnet.
} else {
  // Use Stellar testnet / simulation.
}

// Flip a flag at runtime (no redeploy).
featureFlags.set({
  key: 'live_stellar',
  description: 'Stellar mainnet',
  enabled: true,
  variants: { live: true, simulation: false },
  rolloutPct: 25,           // 25% of merchants
  targetEntities: ['merchant_123', 'merchant_456'],  // + these always-on
  createdAt: 0,
  updatedAt: 0,
});
```

## Secret Management

`src/protocol/deployment/secret-management.ts` exposes a pluggable
secret backend. The default is `EnvSecretProvider` (reads from env
vars); production should swap to `VaultSecretProvider`:

```ts
import { secretManager, VaultSecretProvider } from '@/protocol/deployment';

secretManager.setProvider(new VaultSecretProvider({
  address: process.env.VAULT_ADDRESS!,
  token: process.env.VAULT_TOKEN!,
}));

const dbUrl = secretManager.get('database.primary.url');
if (dbUrl.ok) {
  // Use dbUrl.value.
}
```

## Autoscaling

`src/protocol/deployment/autoscaling.ts` defines three policies:

| Workload               | Metric       | Target | Min | Max |
| ---------------------- | ------------ | ------ | --- | --- |
| `api_server`           | CPU          | 70%    | 2   | 20  |
| `settlement_worker`    | queue_depth  | 100    | 1   | 10  |
| `webhook_dispatcher`   | consumer_lag | 5s     | 1   | 5   |

The Kubernetes HPA (`deploy/kubernetes/hpa.yml`) implements the
`api_server` policy; the worker policies are exposed via the
`AutoscalingService.evaluate()` method for a custom autoscaler (e.g.
KEDA) to consume.

## Health Probes

`src/protocol/deployment/health-probes.ts` exposes three probes that
map directly to the Kubernetes probe spec:

| Probe     | Path       | Checks                                                    |
| --------- | ---------- | --------------------------------------------------------- |
| liveness  | `/healthz` | process alive, memory, event loop                         |
| readiness | `/readyz`  | + event store, chain registry, connectors healthy         |
| startup   | `/startupz`| + instrumentation complete, event store hydrated, modules |

Wire them up as Next.js API routes (or a small Express adapter):

```ts
import { healthProbes } from '@/protocol/deployment';

app.get('/healthz', (req, res) => {
  const r = healthProbes.liveness();
  res.status(r.healthy ? 200 : 503).json(r);
});
```

## Monitoring

`src/protocol/deployment/monitoring.ts` exports the canonical
monitoring configuration:

- **Prometheus** — scrape config (4 targets: api, settlement-worker,
  webhook-dispatcher, node-exporter). Export via
  `monitoringService.exportPrometheusConfig()`.
- **Grafana** — 4 pre-built dashboards (executive, operations,
  treasury, developer). Export via
  `monitoringService.exportGrafanaDashboard('payswap-executive')`.
- **Alert rules** — 8 pre-configured rules (payment failure rate,
  API error rate, settlement latency, connector outage, treasury
  gate breach, replication lag, RPO/RTO violations).
- **SLO targets** — 99.9% payment success, 99.95% API availability,
  p99 < 5s settlement.

## CI/CD Pipeline

`.github/workflows/cicd.yml` (mirrored in `deploy/cicd/github-actions.yml`):

1. **Lint + Typecheck + Test** — every PR + push to `main`.
2. **Build + Push Docker Image** — push to ECR on `main` + tags `v*`.
3. **Deploy to Staging** — Helm upgrade on push to `main`.
4. **Promote to Production** — manual approval gate on tag `v*`,
   blue-green deploy, auto-rollback on failure.

Required GitHub Actions secrets:

- `AWS_DEPLOY_ROLE_ARN` — IAM role for OIDC auth to AWS.
- `AWS_REGION` — `us-east-1` (default).
- `ECR_REGISTRY` — `<account-id>.dkr.ecr.us-east-1.amazonaws.com`.

## Directory Structure

```
deploy/
├── README.md                          # this file
├── docker/
│   ├── Dockerfile                     # multi-stage production build
│   └── docker-compose.yml             # dev/CI compose (app + pg + redis)
├── kubernetes/
│   ├── namespace.yml                  # payswap namespace
│   ├── configmap.yml                  # non-secret configuration
│   ├── secret.yml                     # base64 secret placeholders
│   ├── deployment.yml                 # app deployment + probes + resources
│   ├── service.yml                    # ClusterIP service
│   ├── ingress.yml                    # nginx ingress + TLS
│   ├── hpa.yml                        # horizontal pod autoscaler
│   └── pdb.yml                        # pod disruption budget
├── helm/
│   ├── Chart.yaml                     # chart metadata
│   ├── values.yaml                    # default values
│   └── templates/
│       ├── _helpers.tpl               # template helpers
│       ├── configmap.yaml
│       ├── secret.yaml
│       ├── deployment.yaml
│       ├── service.yaml
│       ├── ingress.yaml
│       └── hpa.yaml
├── terraform/
│   ├── main.tf                        # provider + backend + locals
│   ├── variables.tf                   # input variables
│   ├── vpc.tf                         # VPC + subnets + security groups
│   ├── eks.tf                         # EKS cluster + node groups + ECR
│   ├── rds.tf                         # RDS PostgreSQL (Multi-AZ)
│   ├── s3.tf                          # S3 buckets (backups + assets)
│   ├── cloudfront.tf                  # CloudFront CDN + WAF
│   ├── route53.tf                     # DNS records
│   └── outputs.tf                     # cluster + DB + CDN endpoints
├── cicd/
│   ├── github-actions.yml             # CI/CD pipeline
│   ├── blue-green.yml                 # blue-green deploy script
│   └── canary.yml                     # canary deploy script
└── scripts/
    ├── deploy.sh                      # deploy to K8s (any strategy)
    ├── rollback.sh                    # rollback a deployment
    ├── health-check.sh                # post-deploy health check
    └── seed-production.sh             # seed production data (carefully)

src/protocol/deployment/
├── index.ts                           # barrel export
├── feature-flags.ts                   # FeatureFlagService + featureFlags
├── secret-management.ts               # SecretManager + Env/Vault providers
├── autoscaling.ts                     # AutoscalingService + autoscalingService
├── deployment-strategy.ts             # DeploymentService + deploymentService
├── health-probes.ts                   # HealthProbe + healthProbes
└── monitoring.ts                      # MonitoringService + monitoringService
```

## Verification

```bash
# Lint (TypeScript files only — Docker / Terraform / Helm are not linted).
bun run lint

# Confirm the kernel is untouched.
git diff --name-only HEAD -- src/kernel/ | wc -l   # → 0

# Smoke-test the protocol layer (runtime).
bun -e "
import { featureFlags, secretManager, autoscalingService,
         deploymentService, healthProbes, monitoringService } from './src/protocol/deployment';
console.log('feature flags:', featureFlags.getAll().length);
console.log('autoscaling policies:', Object.keys(autoscalingService.getPolicies()).length);
console.log('monitoring SLOs:', monitoringService.getConfig().sloTargets.length);
console.log('liveness:', healthProbes.liveness().healthy);
"
```

## License

Proprietary — PaySwap Platform Team.
