# NOIR — Operations Runbook

Pragmatic, on-call-friendly reference for the production NOIR ecommerce
platform. Read once before launch; bookmark for incidents.

This document assumes the codebase you are looking at, **not** generic
Next.js / Supabase / Razorpay knowledge. Every reference here is a real
file, table, or endpoint that you can grep.

---

## 1. Stack at a glance

- **Runtime** — Next.js 16 (App Router) on Vercel, Node runtime for all
  API routes that touch crypto / multipart / DB.
- **Database** — Supabase Postgres. RLS-first; service-role client only
  used in API routes that need to bypass RLS for admin / system writes.
- **Payments** — Razorpay (online) + COD. Webhook is the source of
  truth for payment state; client-side `payments/verify` is advisory.
- **Email** — Zoho SMTP (via Nodemailer), all sends behind the job queue.
- **Push** — VAPID web push to admin browsers + service worker
  (`public/sw-admin.js`).
- **Cron** — Vercel Cron → `/api/jobs/run` every minute. See
  `vercel.json`.
- **Observability** — `logEvent()` writes structured JSON to stdout
  AND to `app_events` (Postgres). Per-request correlation via
  `x-request-id` header.

---

## 2. Pre-launch checklist

### 2.1 Environment variables (Vercel project settings)

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — used by `createAdminClient`. Never
  exposed to the browser.
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET` — must match what Razorpay dashboard
  shows; mismatch yields 400 on every webhook.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_HELLO_USER`, and `SMTP_HELLO_PASS` — SMTP configuration for transactional mail. Optionally `SMTP_ORDERS_USER` / `SMTP_ORDERS_PASS` and `SMTP_SUPPORT_USER` / `SMTP_SUPPORT_PASS` for mailbox separation.
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` — admin web push.
- `VAPID_SUBJECT` — e.g. `mailto:ops@yourbrand.com`.
- `CRON_SECRET` — guards `/api/jobs/run`. Vercel Cron sends it as
  the `Authorization: Bearer …` header automatically when set on the
  cron entry.

Optional:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — only if your push prompt code
  reads it on the client. Most paths fetch from `/api/admin/push/vapid`
  instead.

### 2.2 Database migrations

Apply IN ORDER from `supabase/migrations/` via Supabase SQL editor or
the CLI. Key milestones:

- `001_initial.sql` — base schema, atomic `decrement_stock` /
  `restore_stock`.
- `005_order_hardening.sql` → `009_shipping_pricing.sql` —
  `create_order_atomic` (idempotent + atomic).
- `011_coupons_segmentation.sql`, `012_coupons_advanced.sql` —
  homepage coupons + per-user / global usage limits.
- `013_push_subscriptions.sql` — admin push.
- `014_admin_audit_log.sql` — admin audit trail.
- `015_products_archive.sql` — soft-archive.
- `016_app_events.sql` — observability table.
- `017_job_queue.sql` — job queue + `claim_jobs` RPC.
- `018_rate_limits.sql` — `rate_limit_hit` RPC.
- `019_coupon_capacity_lock.sql` — closes the coupon TOCTOU race
  inside `create_order_atomic`.
- `020_perf_indexes.sql` — composite + partial indexes for the admin
  list and the job-queue stale-lease reclaim.

After applying 020, run `ANALYZE` on `orders` and `job_queue` (the
migration does this for you).

### 2.3 Vercel Cron

`vercel.json` contains:

```json
{
  "crons": [{ "path": "/api/jobs/run", "schedule": "* * * * *" }]
}
```

Confirm the cron is **active** in Project → Settings → Cron Jobs.
Without it, queued jobs (emails, push) never fire.

### 2.4 Razorpay dashboard

- Webhook URL: `https://<your-domain>/api/payments/webhook`
- Subscribed events: `payment.captured`, `payment.failed`.
- Secret: matches `RAZORPAY_WEBHOOK_SECRET` exactly.
- Test mode keys in preview deployments only; production must use
  live keys.

### 2.5 Service worker scope

`public/sw-admin.js` is registered by `AdminPushPrompt`. iOS PWA
users must install the site to home screen before push works
(documented in the prompt UI).

---

## 3. Daily ops surface

### 3.1 Admin diagnostics page

`/admin/diagnostics` — protected by the admin layout gate.

**Two tabs:**

1. **Events** — last 100 rows of `app_events`. Filters: severity,
   source, event-name substring, `request_id`, `entity_id`. Click a
   request-id chip to pivot to "everything for this request"; click
   an entity-id to pivot to "everything for this order".
2. **Jobs** — last 100 rows of `job_queue`. Filters: status, kind.
   Failed/dead rows expose **Retry** and **Discard** buttons.

The header shows live counts of `queued / running / failed / dead`
on every page load — this is the primary "is everything OK?" signal.

### 3.2 What to watch

- **`dead` count climbing** — at least one job kind is failing
  permanently. Open the Jobs tab, filter `status=dead`, read
  `last_error`.
- **`failed` count steadily > 0 for one kind** — transient failures
  exceeding the 5-attempt budget. Common cause: third-party outage
  (Resend, push gateway). Check provider status; either retry once
  recovered or discard if known-bad payload.
- **`payment.webhook_stale` warnings in Events** — Razorpay
  re-delivered an event > 30 min after generation. Single instances
  during retry storms are normal; a sustained pattern suggests
  webhook-secret leakage and warrants rotation.
- **`order.coupon_per_user_limit_race` / `order.coupon_usage_limit_race`** —
  the SQL recheck rejected an order because the coupon ran out.
  Expected at boundary conditions; abnormal volume signals a
  coupon promotion needs higher caps.
- **`ratelimit.exceeded`** — at least one IP hit a bucket cap. Map
  the bucket to the endpoint:
  - `coupons.validate` (30/min/IP) — likely coupon-code enumeration.
  - `orders.create` (20/min/IP) — runaway client or bot.

---

## 4. Incident playbooks

### 4.1 "Customer paid but order is still 'pending'"

Symptoms: customer screenshot of Razorpay success, order list shows
`pending` and `payment_status='pending'`.

1. In Supabase: find the order by `order_number`.
2. Check `webhook_event_id` — if NULL, the webhook never reached us.
   - Look at `/admin/diagnostics?tab=events&q=payment.webhook` for
     recent activity.
   - Check Razorpay dashboard → Webhooks → delivery log. If multiple
     5xx, the secret may be wrong (`payment.webhook_misconfigured`
     or `payment.webhook_bad_signature` events).
3. If the webhook simply never came (provider outage), capture the
   payment in the dashboard, then update manually:
   ```sql
   UPDATE orders
      SET payment_status='paid', order_status='confirmed',
          razorpay_payment_id='<from-dashboard>',
          webhook_event_id='manual:<your-initials>:<date>'
    WHERE id='<uuid>';
   ```
   The `webhook_event_id` sentinel keeps a future re-delivery from
   double-applying.

### 4.2 "Stock got out of sync"

Symptoms: customer placed an order, `inventory.stock` did not
decrement, OR the catalogue shows a number that doesn't match what
the order endpoint says.

1. Recall: `/api/products` is edge-cached for 30s with up to 120s
   stale-while-revalidate. Stock numbers there are **always
   advisory**. Order placement is the source of truth via
   `create_order_atomic`.
2. If the actual `inventory.stock` row is wrong:
   ```sql
   SELECT product_id, size, stock FROM inventory
   WHERE product_id='<uuid>' AND size='<size>';
   ```
3. Cross-check against orders:
   ```sql
   SELECT order_status, payment_status, quantity, created_at
   FROM orders
   WHERE product_id='<uuid>' AND size='<size>'
   ORDER BY created_at DESC LIMIT 50;
   ```
4. Manual correction: use the `restore_stock(p_product_id,p_size,n)`
   RPC for clean adjustments. NEVER `UPDATE inventory SET stock=…`
   without a row-level lock — race with concurrent decrements.

### 4.3 "Email or push notification didn't go out"

1. `/admin/diagnostics?tab=jobs&kind=email` — confirm the row
   exists and look at status.
   - `succeeded` → it was sent; check spam / push-subscription
     rotation.
   - `failed` → cron will retry; backoff is exponential up to 5
     attempts.
   - `dead` → click **Retry** after fixing the root cause (e.g.
     correct SMTP_HELLO_PASS).
2. If the row doesn't exist at all, the enqueue at the call site
   was skipped or threw. Check the parent route's events for the
   request id (e.g. `payment.webhook_received` → no
   `email.payment_success` enqueue → look for the route's error
   log on the same `request_id`).

### 4.4 "/api/jobs/run is failing or not running"

1. Vercel → Project → Cron Jobs → check last invocation status.
2. If 401, `CRON_SECRET` mismatched; redeploy with the correct env.
3. If 5xx, hit it manually with the secret:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
        https://<host>/api/jobs/run
   ```
   The endpoint returns `{ claimed, succeeded, failed }` — claimed=0
   when the queue is empty. A non-empty queue with claimed=0
   usually means another runner is holding the leases (rare on
   single-region Vercel).

### 4.5 "Coupon won't apply at checkout"

User reports their valid code is rejected.

1. Check the coupon row directly. Common causes:
   - `is_active=false`
   - `starts_at > now()` or `expires_at < now()`
   - `min_cart_paise` exceeds the user's subtotal
   - `usage_limit` already consumed by abandoned `pending` orders
     (see "known gotchas" below)
2. The exact rejection reason is logged as `order.coupon_rejected`
   in `app_events` with the stable string — search by `request_id`
   from the user's bug report.

### 4.6 "Admin push notifications stopped working on Android Chrome"

Specific gotcha: Chrome silently drops a push if the icon URL
404s. We removed the icon reference from `public/sw-admin.js` for
exactly this reason. If you re-add icons, host them under the
deployment's own origin, **never** absolute URLs that may break
across environments.

---

## 5. Known gotchas (read once)

- **Pending orders permanently consume `coupon.usage_limit`.** A
  guest who abandons checkout holds their slot. Fix in roadmap:
  "expire pending orders after N hours" sweeper job. For now, the
  admin can manually `UPDATE orders SET order_status='cancelled'
  WHERE id=…` to free the slot — the count predicate filters
  cancelled rows.
- **Razorpay retries up to 24h**. The webhook handler logs
  `payment.webhook_stale` for events older than 30min but does
  **not** reject them — rejecting would drop legitimate retries
  during outages.
- **Admin push is best-effort**. The diagnostics surface is the
  authoritative view. If push fails for one admin, others may still
  receive it. The `notifyAdmins` helper marks a job failed only if
  every subscription failed.
- **Service-role key must never reach the browser.** Every API
  route that uses `createAdminClient()` must run with
  `runtime = 'nodejs'` (already set; do not change to `edge`).
- **`force-dynamic` on a route disables edge caching.** Only set
  it where a route MUST run per-request and there is no benefit to
  CDN caching (most authenticated routes).

---

## 6. Map: where things live

```
src/
  app/
    api/
      orders/route.ts                — order creation (atomic + idempotent)
      payments/
        webhook/route.ts             — Razorpay source of truth
        verify/route.ts              — client-side verify (advisory)
      coupons/validate/route.ts      — server-authoritative coupon check
      jobs/run/route.ts              — Vercel Cron runner
      admin/jobs/[id]/retry/route.ts — manual job retry
      admin/jobs/[id]/discard/route.ts
      admin/upload/route.ts          — admin media upload (admin-gated)
      admin/push/{subscribe,vapid,test}/route.ts
    admin/(protected)/
      diagnostics/page.tsx           — events + jobs surface
      orders/, products/, coupons/, shipping/
  lib/
    log.ts                           — structured logEvent()
    observability/context.ts         — AsyncLocalStorage request ctx
    rateLimit.ts                     — enforceRateLimit()
    jobs/{queue.ts,handlers.ts}      — enqueue + handler registry
    coupons/evaluateCoupon.ts        — single source of truth coupon logic
    audit/logAdminAction.ts          — admin audit log writer
    push/webPush.ts                  — VAPID send + notifyAdmins
    email/sendOrderEmail.ts          — Zoho SMTP / Nodemailer wrappers
  proxy.ts                           — request id, auth gate, cookie refresh
public/
  sw-admin.js                        — service worker (admin push)
supabase/migrations/                 — apply in numeric order
vercel.json                          — cron entry
next.config.ts                       — security headers (CSP, HSTS, etc.)
```

---

## 7. Releasing changes

1. Run `npm run build` locally — must compile cleanly with zero
   warnings (the build pipeline does NOT have a separate lint
   gate; the build catches type errors).
2. Apply any new migrations in Supabase BEFORE merging the deploy.
3. Push to `main`; Vercel auto-deploys.
4. Within 60 seconds of deploy: hit `/admin/diagnostics` and
   confirm the events feed is live and the job runner is processing
   (queued count should not be steadily growing).

---

## 8. Rotating secrets

- **`RAZORPAY_WEBHOOK_SECRET`** — set the new value in Razorpay
  dashboard FIRST (Razorpay accepts both old + new for a grace
  window), then update Vercel env, then redeploy. Watch
  `payment.webhook_bad_signature` events; spike during rotation is
  expected to be near-zero if done in this order.
- **`SUPABASE_SERVICE_ROLE_KEY`** — generate the new key in
  Supabase, update Vercel env, redeploy. Old key remains valid
  until you click "Revoke" — keep the old one alive until you've
  confirmed the deploy is healthy.
- **`VAPID_*`** — rotation invalidates EVERY admin subscription.
  Avoid unless compromised. After rotation, every admin must
  re-subscribe via the push prompt.
- **`CRON_SECRET`** — update env, redeploy. The Vercel Cron entry
  picks up the new secret automatically on the next tick.

---

## 9. Hardening features summary (what shipped in this pass)

| Concern              | What was added                                     |
|----------------------|----------------------------------------------------|
| Async reliability    | Postgres job queue (`017`), cron runner, idempotency keys |
| Observability        | `app_events` table (`016`), structured `logEvent`, request-id correlation, admin diagnostics page |
| Security headers     | CSP, HSTS, frame-ancestors, permissions-policy in `next.config.ts` |
| Rate limiting        | `rate_limit_hit` RPC (`018`), enforced on `/api/coupons/validate` and `/api/orders` |
| Webhook integrity    | HMAC + event-id dedupe + stale-event observability |
| Data integrity       | Coupon TOCTOU closed inside `create_order_atomic` (`019`) |
| Performance          | Composite index `idx_orders_status_created` (`020`), edge cache on `/api/products` |
| Audit trail          | `admin_audit_log` (`014`), wired through coupon delete, product archive, job retry/discard |
| Soft-archive         | Products non-destructively removable; FK integrity preserved (`015`) |

---

## 10. Useful one-liners

Job queue health (Supabase SQL editor):

```sql
SELECT status, COUNT(*) FROM job_queue GROUP BY status;
SELECT kind, status, COUNT(*) FROM job_queue
 WHERE status IN ('failed','dead') GROUP BY kind, status;
```

Recent errors (last hour):

```sql
SELECT created_at, event, metadata
  FROM app_events
 WHERE severity IN ('error','fatal')
   AND created_at > now() - interval '1 hour'
 ORDER BY created_at DESC LIMIT 50;
```

Stuck online orders (paid intent, never confirmed by webhook):

```sql
SELECT id, order_number, created_at FROM orders
 WHERE payment_method='online'
   AND payment_status='pending'
   AND created_at < now() - interval '30 minutes'
 ORDER BY created_at DESC;
```

Coupon usage snapshot:

```sql
SELECT coupon_code, COUNT(*) FILTER (WHERE order_status<>'cancelled') AS used
  FROM orders WHERE coupon_code IS NOT NULL
 GROUP BY coupon_code ORDER BY used DESC;
```

Rate limit pressure (current windows):

```sql
SELECT key, count, window_started_at
  FROM rate_limits
 ORDER BY count DESC LIMIT 20;
```
