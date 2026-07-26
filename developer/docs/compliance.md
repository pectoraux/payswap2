# Compliance

PaySwap ships an embedded compliance toolkit that screens every
customer, payout destination, and payment counterparty against global
sanctions / PEP / adverse-media lists **before** the transaction settles.
This guide covers the developer-facing compliance surface.

## What gets screened, when

| Trigger                          | Screened entity            | Lists checked                        | Outcome                                  |
|----------------------------------|----------------------------|--------------------------------------|------------------------------------------|
| Customer create                  | Customer                   | OFAC, EU, UN, UK HMT, PEP, adverse   | Soft block on hit; surfaces in dashboard |
| Payment create                   | Customer + counterparty    | OFAC, EU, UN, UK HMT                 | Hard block on hit (≥ 85 score)           |
| Payout `process`                 | Destination owner          | OFAC, EU, UN, UK HMT, PEP            | Hard block on hit; payout stays `pending`|
| Manual `POST /compliance/screen` | Any entity you supply      | Your choice of lists                 | Returns a screening result               |

Screening runs synchronously and adds < 100 ms p99 to the request.

## Manual screening

```bash
POST /compliance/screen
```

```ts
const result = await fetch(`${baseUrl}/compliance/screen`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    entity: {
      name: 'John Doe',
      type: 'individual',
      dob: '1980-01-01',
      nationality: 'KE',
      identifiers: ['passport_A12345', 'phone_+254700000000'],
    },
    lists: ['ofac', 'eu', 'un', 'uk_hmt', 'pep', 'adverse_media'],
  }),
}).then(r => r.json());
```

Response:

```json
{
  "screened": true,
  "hits": [
    {
      "list": "ofac",
      "score": 0.92,
      "matchedName": "John DOE"
    }
  ],
  "score": 0.92,
  "recommendation": "block",
  "checkedAt": 1735000000123
}
```

| Field           | Description                                                    |
|-----------------|----------------------------------------------------------------|
| `screened`      | `true` if the screening ran successfully.                      |
| `hits`          | Array of matches across the requested lists.                   |
| `hits[].list`   | Which list matched (`ofac`, `eu`, `un`, `uk_hmt`, `pep`, `adverse_media`). |
| `hits[].score`  | 0–1 fuzzy-match score. ≥ 0.85 = high confidence.               |
| `hits[].matchedName` | The name as it appears on the list (for audit).           |
| `score`         | Highest hit score (or 0 if no hits).                           |
| `recommendation`| `clear` (no hits), `review` (low-confidence hit), `block` (high-confidence hit). |
| `checkedAt`     | Epoch ms when the screening ran.                               |

## Lists supported

| List             | Source                                    | Update cadence |
|------------------|-------------------------------------------|----------------|
| `ofac`           | US Treasury OFAC SDN list                 | daily          |
| `eu`             | EU consolidated financial sanctions       | daily          |
| `un`             | UN Security Council Consolidated List     | daily          |
| `uk_hmt`         | UK HM Treasury OFSI consolidated list     | daily          |
| `pep`            | Politically Exposed Persons registry      | weekly         |
| `adverse_media`  | Curated adverse-media feeds               | weekly         |

## Blocking behaviour

When a transaction screens as `block`:

- **Payment**: returns `403` with `code=compliance_block`. The payment is
  recorded with `status=failed` and a `compliance_hit` is logged.
- **Payout**: the payout stays in `pending` state. You must cancel it
  (`POST /payouts/{id}/cancel`) or supply a different destination.
- **Customer create**: the customer record is created with `status=blocked`
  and no API key can charge them.

When a transaction screens as `review`:

- The transaction proceeds normally.
- A case is opened in the compliance dashboard for human review.
- A `compliance.alert` webhook is fired.

## Case management

Cases are surfaced in the dashboard at
<https://dashboard.payswap.io/compliance/cases>. Each case links to the
screening result and the affected resource. Compliance analysts can:

- Mark the case `cleared` (transaction proceeds).
- Mark the case `blocked` (transaction fails, customer / payout blocked).
- Request more documentation from the customer via the dashboard.

Cases are also accessible via the audit export (below).

## Audit export

```bash
GET /compliance/audit-export?from=1735000000&to=1735086400
```

```ts
const audit = await fetch(
  `${baseUrl}/compliance/audit-export?from=${from}&to=${to}`,
  { headers: { Authorization: `Bearer ${apiKey}` } },
).then(r => r.json());

for (const entry of audit.entries) {
  console.log(entry.ts, entry.actor, entry.action, entry.target, entry.result);
}
```

| Field     | Description                                                |
|-----------|------------------------------------------------------------|
| `ts`      | Epoch ms.                                                  |
| `actor`   | User or API key that triggered the action.                 |
| `action`  | `screen`, `case_open`, `case_clear`, `case_block`, …       |
| `target`  | Resource id affected (customer / payout / payment).        |
| `result`  | `clear`, `review`, `block`, `cleared`, `blocked`.          |

The audit log is immutable and retained for 7 years.

## Webhook events

| Event type          | Fired when …                                |
|---------------------|---------------------------------------------|
| `compliance.alert`  | Screening returned `review` or `block`.     |
| `compliance.case_open`   | A new case was opened in the dashboard.|
| `compliance.case_clear`  | A case was cleared.                    |
| `compliance.case_block`  | A case was blocked.                    |

## Best practices

- **Always** check `recommendation` on the screening result. The `score`
  alone is not enough — `review` cases need human eyes.
- **Always** handle `403 compliance_block` errors from `payments.create`
  and `payouts.process` gracefully — show the user a friendly message,
  don't retry the same request.
- **Don't** re-screen on every transaction. PaySwap caches screening
  results for 24h per entity; manual re-screens cost API quota.
- **Do** subscribe to `compliance.alert` webhooks so your ops team is
  notified the moment a case is opened.
- **Do** export the audit log to your SIEM weekly.

## KYC / KYB

For higher-risk merchants, PaySwap also exposes KYC (individual) and KYB
(business) verification endpoints. These are **not** covered in this
public guide — they're part of the merchant-onboarding flow under
`/internal/kyc/*` and require a `compliance:write` scope. Contact
<developers@payswap.io> to enable KYC / KYB for your account.
