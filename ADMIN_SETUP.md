# KickoffPro Admin Account Setup Guide

Follow this guide to create and authorize an admin account in your KickoffPro production database.

---

## Step 1 — Create a User Account
You can create a user account in either of two ways:

### Method A: Via the Storefront
1. Navigate to `/auth` on the storefront.
2. Enter the target email (e.g., `admin@kickoffpro.com`) and click **Send Secure Link**.
3. Open your inbox, click the magic link. This creates the user record inside the `auth.users` table and establishes a session.

### Method B: Via the Supabase Dashboard (Recommended)
1. Go to **Supabase Dashboard** -> **Authentication** -> **Users**.
2. Click **Add User** -> **Create User**.
3. Enter the email and a secure password. Make sure to toggle **Auto-confirm User** to `true` (so they do not need to verify their email to log in).
4. Click **Save**.

---

## Step 2 — Retrieve the User's UID
1. In the **Supabase Dashboard** -> **Authentication** -> **Users** table, find your newly created user.
2. Copy the UUID from the **User UID** column (it looks like `d3b07384-d113-4956-aa96-e17f7b3df623`).

*Alternatively, query the UID via the SQL Editor:*
```sql
SELECT id FROM auth.users WHERE email = 'admin@kickoffpro.com';
```

---

## Step 3 — Insert the Admin Record
Go to the **Supabase Dashboard** -> **SQL Editor** -> **New Query**, and run the following exact SQL statement (replace the UUID placeholder with your copied user UID):

```sql
INSERT INTO public.admin_users (id, email, role)
VALUES (
  'd3b07384-d113-4956-aa96-e17f7b3df623', -- REPLACE THIS WITH YOUR USER'S EXACT COPIED UID
  'admin@kickoffpro.com',                -- REPLACE WITH YOUR ADMIN'S EXACT EMAIL
  'admin'
)
ON CONFLICT (id) DO NOTHING;
```

---

## Step 4 — Verify Admin Database Privileges
Verify that the record was created and has the correct role:
```sql
SELECT * FROM public.admin_users WHERE email = 'admin@kickoffpro.com';
```

---

## Step 5 — Log In to the Admin Panel
1. Navigate to `/admin` in your browser.
2. Enter the admin credentials (email and password created in Step 1).
3. Click **LOGIN**.

---

## Step 6 — Access the Dashboard
Once the login is successful, you will be automatically redirected to `/admin/dashboard`. You can now access all diagnostic data, manage products, view orders, and set up shipping.
