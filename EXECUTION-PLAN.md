# PaySwap — Execution Plan (Phase 2)

## Milestones (each leaves app in working state)

### M1: Foundation (database + auth + app shell)
- Prisma schema: all models, indexes, enums
- NextAuth: credentials provider, session management, middleware
- Admin account: ekontetevi@gmail.com / Payswap123456
- Demo accounts: merchant, customer, LP, treasury, compliance, support, ops
- App shell: role-based sidebar, header, route protection
- Login page with demo quick-login buttons
- Marketing landing page + waitlist page
- **Gate**: App boots, user can login, sees role-appropriate dashboard

### M2: Merchant Platform (core)
- Dashboard overview (KPIs from DB)
- Payments list + detail
- Payouts list + create + detail
- Customers list + detail
- Products CRUD
- Invoices CRUD
- Analytics with charts
- Settings (API keys, webhooks, team, branding)
- **Gate**: Merchant can view real data, create payouts, manage products

### M3: Customer Portal
- Customer dashboard
- Payment history + receipts
- Wallet balance
- Invoice payment
- **Gate**: Customer can view payments, pay invoices

### M4: Admin & Compliance
- Admin waitlist management
- User management
- Merchant oversight
- Compliance overview (alerts, KYC queue)
- **Gate**: Admin can approve users, compliance can review alerts

### M5: Polish
- Loading skeletons everywhere
- Empty states everywhere
- Error boundaries + toast
- Mobile responsive layouts
- Dark mode verified
- **Gate**: No console errors, no layout breaks, feels like Stripe

## Build Order (dependency graph)
```
Schema → Auth → App Shell → Merchant Pages → Customer Portal → Admin → Polish
```

Every milestone: lint → typecheck → browser verify → commit → push to GitHub → deploy to Vercel.
