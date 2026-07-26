# Milestone 2 — Gap Review: Merchant Platform (Stripe Quality)

## 1. What gap with Stripe was closed?

**Dispute Center**: Merchants can now manage disputes (pending refunds) with Approve/Reject actions, KPIs (open count, disputed amount, win rate, avg resolution time), and filterable tables. This matches Stripe's dispute management workflow.

**Merchant Health Score**: A real-time 0-100 health score computed from DB data (payment success rate, refund rate, dispute rate, settlement time, API usage) with per-factor breakdown and AI-style recommendations. This exceeds Stripe's merchant health indicators.

**Customer CRM**: Customer detail pages now show tags (VIP, Frequent, At Risk), AML risk indicators, lifetime value charts (6-month bar chart), and merchant notes. This approaches Stripe's customer CRM quality.

## 2. What gap remains?

- **Product variants/inventory**: Products are still flat (no variants, no inventory tracking)
- **Quotes/estimates/credit notes**: Not implemented
- **Scheduled/automatic refunds**: Not implemented
- **Bulk refunds**: Not implemented
- **A/B checkout testing**: Not implemented
- **Merchant onboarding score**: Not implemented
- **Conversion optimization**: Not implemented
- **Growth insights**: Not implemented
- **Terminal architecture**: Not started

## 3. What unique PaySwap capability was added that Stripe does not have?

**AML risk indicator on customers**: PaySwap shows compliance alerts directly on customer profiles — Stripe does not integrate compliance into the customer CRM.

**Health score includes dispute rate as a primary factor**: Stripe's health indicators focus on payment volume and chargeback rate. PaySwap's health score is more holistic, including settlement time and API usage.

## 4. Does the implementation preserve the frozen kernel?

**Yes.** Zero files modified in `src/kernel/`.

## 5. Does the Sandbox and Live environment behave correctly?

**Yes.** All new API routes use `getEnvironment()` for sandbox/live filtering.

## 6. Can every new capability be exercised through the simulator?

**Partially.** The simulator creates refunds (which become disputes) and payments (which affect health score). The health score and dispute center update automatically. Customer notes and tags are not yet simulated.

## 7. What architectural debt was introduced?

- Disputes reuse the Refund model rather than having a dedicated Dispute model. This works but makes the distinction between "merchant-initiated refund" and "customer-initiated dispute" ambiguous.
- The health score computation runs synchronously in the API route. For large datasets, this should be cached or computed asynchronously.

## 8. What should be refactored before the next milestone?

- Consider a dedicated `Dispute` model if dispute workflows become more complex
- Cache the health score (recompute every 5 minutes instead of on every request)
- Move customer tags to a computed/cached field rather than computing on every page load

## 9. Production readiness score (0–100)

**45/100** — The merchant platform is now functional end-to-end with real workflows. Missing: product variants, scheduled refunds, bulk operations, A/B testing, and growth analytics.

## 10. Estimated parity with Stripe (0–100)

**35%** for the merchant platform specifically. Stripe has product variants, inventory, quotes, credit notes, scheduled refunds, bulk refunds, disputes with evidence submission, A/B checkout testing, conversion analytics, and growth insights. PaySwap has the core workflows (payments, payouts, refunds, disputes, customers, products, invoices, analytics, reports, checkout, QR, payment links, extensions, team, billing) with real data persistence and cross-resource navigation.
