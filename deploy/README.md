# KickoffPro — Background Queue Worker Deployment Guide (OCI / Linux)

This guide documents how to run the KickoffPro background queue worker as a managed `systemd` service on an **Oracle Cloud Infrastructure (OCI) Virtual Machine** (Ubuntu or Oracle Linux) and easily carry it over to other production VPS / container environments.

---

## 1. Architecture Overview

KickoffPro uses an asynchronous database-backed job queue (`jobs` table in Supabase) to offload heavy and non-blocking tasks from user-facing HTTP request paths:

| Job Kind | Purpose | Handled By |
| :--- | :--- | :--- |
| `email.order_created` | Sends order confirmation receipt with item details | Resend or Zoho SMTP |
| `email.payment_success` | Sends payment received notification for online orders | Resend or Zoho SMTP |
| `email.payment_failed` | Alerts customer when online payment could not complete | Resend or Zoho SMTP |
| `email.order_status` | Sends shipping & delivery status milestone updates | Resend or Zoho SMTP |
| `push.admin_notify` | Sends web push notifications to store administrators | WebPush / VAPID |
| `tracking.capi_purchase` | Dispatches server-to-server Meta Conversions API events | Meta Graph API |

The queue worker runs as a persistent service via `npm run worker` (`tsx src/workers/queue-worker.ts`), polling the queue every **~10–15s when active**, dynamically backing off to **~20–30s when idle**, and executing clean **SIGTERM / SIGINT graceful shutdowns**.

---

## 2. Environment Variables & Portability Guide

The worker requires access to your database and delivery credentials. When running as a systemd service, these variables are loaded directly from the `.env` file pointed to by `EnvironmentFile=/var/www/kickoffpro/.env`.

### Core Required Keys

| Variable | Required | Description | Example / Notes |
| :--- | :---: | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Supabase project API URL | `https://xxxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Server-only Supabase service secret | `eyJhbGciOi...` (bypasses RLS to claim & update jobs) |
| `EMAIL_FROM` | **Yes** | Sender email string displayed to customers | `KickoffPro Orders <orders@kickoffpro.in>` |

### Email Delivery Provider (Choose Resend or SMTP)

The email dispatcher (`src/lib/email/sendOrderEmail.ts`) supports both Resend API and SMTP. Set at least one option:

#### Option A: Resend (Recommended for Cloud / OCI)
| Variable | Description |
| :--- | :--- |
| `RESEND_API_KEY` | Resend API key (e.g., `re_xxxxxxxxxxxx`). When present, emails are dispatched via Resend REST API. |

#### Option B: SMTP (Zoho Mail / Custom Mail Server)
| Variable | Description |
| :--- | :--- |
| `SMTP_HOST` | Hostname of SMTP server (e.g., `smtppro.zoho.in` or `smtp.gmail.com`) |
| `SMTP_PORT` | Port (`465` for SSL, `587` for TLS) |
| `SMTP_HELLO_USER` | Primary mailbox username / address (e.g., `hello@kickoffpro.in`) |
| `SMTP_HELLO_PASS` | Mailbox password or app-specific password |
| `SMTP_ORDERS_USER` | *(Optional)* Dedicated orders mailbox |
| `SMTP_ORDERS_PASS` | *(Optional)* Dedicated orders mailbox password |
| `SMTP_SUPPORT_USER` | *(Optional)* Dedicated support mailbox |
| `SMTP_SUPPORT_PASS` | *(Optional)* Dedicated support mailbox password |

### Tracking & WebPush Keys (Optional)

| Variable | Description |
| :--- | :--- |
| `NEXT_PUBLIC_URL` | Storefront public URL (used for building order tracking links in emails) |
| `META_CAPI_ACCESS_TOKEN` | Meta System User Access Token for server-side CAPI dispatches |
| `NEXT_PUBLIC_META_PIXEL_ID` | Meta Pixel ID |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key |
| `VAPID_SUBJECT` | Web Push mailto identifier (e.g., `mailto:admin@kickoffpro.in`) |
| `APP_ENCRYPTION_KEY` | 32-byte hex key for decrypting CAPI tokens stored in database |

### Worker Polling Tuning (Optional)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `QUEUE_WORKER_ACTIVE_INTERVAL_MS` | `10000` (10s) | Polling frequency when jobs were found in previous batch |
| `QUEUE_WORKER_IDLE_INTERVAL_MS` | `25000` (25s) | Polling backoff when queue is drained/idle |
| `QUEUE_WORKER_BATCH_SIZE` | `10` | Maximum jobs claimed per cycle |
| `QUEUE_WORKER_LEASE_SECONDS` | `60` | Lock lease duration to prevent duplicate runs |

---

## 3. Step-by-Step Setup on Oracle Cloud VM (OCI)

### Step 1: Provision & Connect to your VM
SSH into your Oracle Cloud Compute Instance:
```bash
ssh -i ~/.ssh/id_rsa ubuntu@<YOUR_OCI_PUBLIC_IP>
# Note: Default user is 'ubuntu' on Ubuntu images, or 'opc' on Oracle Linux.
```

### Step 2: Install Node.js (v20 or v22 LTS)
```bash
# Example for Ubuntu 22.04 / 24.04:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential
```

Verify installation:
```bash
node -v   # Should output v22.x or v20.x
npm -v
```

### Step 3: Deploy KickoffPro & Install Dependencies
Clone your repository to `/var/www/kickoffpro` (or your preferred directory):
```bash
sudo mkdir -p /var/www/kickoffpro
sudo chown -R $USER:$USER /var/www/kickoffpro
git clone https://github.com/jawadkoroth/kickoffpro.git /var/www/kickoffpro
cd /var/www/kickoffpro

# Install dependencies
npm ci
```

### Step 4: Configure Production Environment Variables
Create `/var/www/kickoffpro/.env`:
```bash
nano /var/www/kickoffpro/.env
```

Paste your production keys:
```ini
NODE_ENV=production
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret

# Email setup (Resend or Zoho)
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=KickoffPro Orders <orders@kickoffpro.in>

# App URL
NEXT_PUBLIC_URL=https://kickoffpro.in
```

Protect file permissions:
```bash
chmod 600 /var/www/kickoffpro/.env
```

### Step 5: Install & Start the Systemd Service
1. Copy the service unit file to systemd:
   ```bash
   sudo cp deploy/kickoffpro-worker.service /etc/systemd/system/
   ```

2. If your VM user or directory differs from `/var/www/kickoffpro` and `ubuntu`, adjust `/etc/systemd/system/kickoffpro-worker.service`:
   ```bash
   sudo nano /etc/systemd/system/kickoffpro-worker.service
   ```
   *(e.g., set `User=opc` and `Group=opc` if running on Oracle Linux)*.

3. Reload systemd daemon:
   ```bash
   sudo systemctl daemon-reload
   ```

4. Enable the service so it automatically launches on system boot / VM reboots:
   ```bash
   sudo systemctl enable kickoffpro-worker
   ```

5. Start the worker:
   ```bash
   sudo systemctl start kickoffpro-worker
   ```

---

## 4. Service Management & Monitoring

### Check Service Status
```bash
sudo systemctl status kickoffpro-worker
```
Expected output:
```text
● kickoffpro-worker.service - KickoffPro Background Queue Worker
     Loaded: loaded (/etc/systemd/system/kickoffpro-worker.service; enabled)
     Active: active (running) since ...
```

### View Real-Time Streaming Logs
```bash
journalctl -u kickoffpro-worker -f
```

Sample output:
```text
[WORKER] KickoffPro Background Queue Worker started (PID: 12345)
[WORKER] Active Poll: 10000ms (~10s)
[WORKER] Idle Backoff: 25000ms (~25s)
[WORKER] Available Handlers: email.order_created, email.payment_success, email.payment_failed, email.order_status, push.admin_notify, tracking.capi_purchase
[WORKER] Loop started. Polling for jobs...
[WORKER] Queue drained. Backing off to idle polling (25s).
```

### Restart / Stop Service
```bash
# Restart after updating code or environment variables
sudo systemctl restart kickoffpro-worker

# Stop service
sudo systemctl stop kickoffpro-worker
```

---

## 5. Trial-to-Production Portability

Because the queue worker:
1. Depends only on standard `process.env` keys without hardcoded machine paths,
2. Reads credentials cleanly from `EnvironmentFile`,
3. Implements standard POSIX `SIGTERM`/`SIGINT` signals,

You can easily replicate this setup on any environment:
- **Secondary VPS / Droplet / AWS EC2 / Hetzner**: Simply copy the service file, update `WorkingDirectory`, and run `systemctl start kickoffpro-worker`.
- **Docker / Kubernetes**: Run `npm run worker` as the container `CMD` or as a background Kubernetes Deployment with the same environment variables.
