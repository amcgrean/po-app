# PO Check-In — Agent & Developer Notes

This document captures what has been learned about the setup, configuration, and
architecture of this repository so future agents and developers can get up to speed quickly.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, TypeScript) |
| Styling | Tailwind CSS |
| Database & Auth | Supabase (PostgreSQL + Supabase Auth) |
| File Storage | AWS S3-compatible (Cloudflare R2) |
| PWA | next-pwa |
| Deployment | Vercel (inferred from project structure) |

The web app lives in `web/`. All Next.js commands must be run from `web/`.

---

## Environment Variables

Two sets of Supabase clients exist:

- **`createClient()` (server)** — uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (with cookie-based session management via Supabase SSR helpers)
- **`createServiceClient()` (server only)** — uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS;
  required for reading ERP mirror views (`app_po_*`) and admin user management

Missing or wrong service key is the most common cause of "Open POs could not be loaded" errors.

S3 / R2 variables used by `app/api/upload/route.ts`:
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `NEXT_PUBLIC_S3_PUBLIC_URL` — public base URL for reading uploaded images

---

## Authentication

- All auth is email/password via Supabase Auth.
- Users are created with a synthetic email: `{username}@checkin.internal`.
  The login page converts the entered username to this format before calling
  `supabase.auth.signInWithPassword()`.
- After login, role-based redirect:
  - `admin` → `/admin/users`
  - `supervisor` → `/supervisor`
  - `manager` → `/manager`
  - `worker` / default → `/`

### Auth setup gotcha — `email_change_type` column

If you run SQL migrations or updates against `auth.users` and get:

```
ERROR: 42703: column "email_change_type" does not exist
```

This column does not exist in the version of Supabase Auth used here.
Remove it from the query and use only the columns that actually exist:

```sql
update auth.users
set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  reauthentication_token     = coalesce(reauthentication_token, ''),
  email_change               = coalesce(email_change, ''),
  phone                      = coalesce(phone, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, '')
where email = '<username>@checkin.internal';
```

---

## User Roles & Route Groups

| Role | Route Group | Home Path | Can Do |
|------|-------------|-----------|--------|
| `admin` | `/app/admin/` | `/admin/users` | Manage users, view all submissions & open POs |
| `supervisor` | `/(supervisor)/supervisor/` | `/supervisor` | Review submissions, view branch open POs |
| `manager` | `/(manager)/manager/` | `/manager` | Review branch submissions |
| `worker` | `/(worker)/` | `/` | Submit check-ins, view own history |

- Each role group has its own `layout.tsx` with role-appropriate navigation.
- The middleware (`web/middleware.ts`) only refreshes Supabase sessions; it does **not**
  enforce role-based redirects. Role enforcement is done at the page/API level.
- Branch code is stored in `profiles.branch` and used to filter both ERP data and submissions.
  Admin users do not require a branch.

---

## Database Schema Overview

### `profiles` table
Stores user metadata. Keyed by `id` (= `auth.users.id`).

| Column | Notes |
|--------|-------|
| `id` | UUID, FK to `auth.users` |
| `username` | Short identifier (no @) |
| `display_name` | Human-readable name |
| `role` | `admin` / `supervisor` / `manager` / `worker` |
| `branch` | Branch code (required for non-admin roles) |

### `submissions` table
Photo check-in records submitted by workers.

| Column | Notes |
|--------|-------|
| `id` | UUID |
| `po_number` | PO being checked in |
| `image_url` | Primary photo URL (legacy single-photo) |
| `image_urls` | Array of photo URLs (multi-photo) |
| `image_keys` | S3 object keys |
| `submitted_by` | User ID |
| `submitted_username` | Denormalised username |
| `branch` | Worker's branch at submission time |
| `status` | `pending` / `reviewed` / `flagged` |
| `reviewer_notes` | Text set by supervisor/admin during review |
| `reviewed_by` | User ID of reviewer |
| `reviewed_at` | Timestamp |

### ERP mirror tables (canonical data)

All ERP data lives in `erp_mirror_*` tables, synced by the main ERP worker.
Every mirror table uses:
- `id` (auto-increment integer) as the primary key
- `is_deleted` (boolean) for soft-delete — **always filter with `WHERE is_deleted = false`**
- `source_updated_at` / `synced_at` timestamps for change tracking
- `system_id` as the branch identifier

> **Retired flat tables** — The old `customers`, `sales_orders`, `sales_order_lines`,
> `inventory`, and `dispatch_orders` tables were stale prototypes with 0 rows.
> They were dropped in migration `20260325000000_drop_stale_flat_tables.sql`.
> Do **not** recreate or reference them.

#### Customers

| Table | Key | Notable columns |
|-------|-----|-----------------|
| `erp_mirror_cust` | `cust_key`, `cust_code` | `cust_name`, `phone`, `email`, `balance`, `credit_limit`, `credit_account`, `cust_type`, `branch_code` |
| `erp_mirror_cust_shipto` | `cust_key` + `seq_num` | `shipto_name`, `city`, `state`, `branch_code` |

> Note: `erp_mirror_cust` uses `id` as PK — there is **no** `prowid` column.

#### Sales Orders

| Table | Key | Notable columns |
|-------|-----|-----------------|
| `erp_mirror_so_header` | `system_id` + `so_id` | `cust_key`, `ship_via`, `so_status`, `expect_date`, `branch_code`, `salesperson`, `po_number`, `reference` |
| `erp_mirror_so_detail` | `so_id` + `sequence` | `item_ptr`, `qty_ordered`, `price`, `price_uom_ptr`, `bo`, `so_desc` |

#### Inventory / Items

| Table | Key | Notable columns |
|-------|-----|-----------------|
| `erp_mirror_item` | `item_ptr` | `item` (code), `description`, `size_`, `type`, `stocking_uom`, `costing_uom`, `tally_uom`, `default_uom_conv_factor`, `pg_ptr`, `keyword_string` |
| `erp_mirror_item_branch` | `system_id` + `item_ptr` | `item`, `active_flag`, `stock`, `display_uom`, `picking_uom`, `weight`, `weight_uom`, `buyer_id`, `handling_code`, `contentcode`, `discontinued_item` |
| `erp_mirror_item_uomconv` | `system_id` + `item_ptr` | UOM conversion factors |

#### Dispatch / Shipments

| Table | Key | Notable columns |
|-------|-----|-----------------|
| `erp_mirror_shipments_header` | `so_id` + `shipment_num` | `ship_date`, `status_flag`, `driver`, `route_id_char`, `ship_via`, `loaded_date`, `loaded_time`, `status_flag_delivery`, `expect_date` |
| `erp_mirror_shipments_detail` | shipment detail rows | Line-level shipment data |

#### Purchase Orders

| Table | Key | Notable columns |
|-------|-----|-----------------|
| `erp_mirror_po_header` | `system_id` + `po_id` | `supplier_key`, `shipfrom_seq`, `order_date`, `expect_date`, `buyer`, `reference`, `ship_via`, `po_status`, `wms_status` |
| `erp_mirror_po_detail` | `po_id` + `sequence` | `item_ptr`, `qty_ordered`, `cost`, `uom`, `po_status`, `wo_id`, `expect_date` |
| `erp_mirror_receiving_header` | `po_id` + `receive_num` | `receive_date`, `recv_status` |
| `erp_mirror_receiving_detail` | receiving line rows | `qty` received per line |

#### Other mirror tables

| Table | Purpose |
|-------|---------|
| `erp_mirror_wo_header` | Work orders (joined by `wo_id` from PO detail) |
| `erp_mirror_pick_header` / `_detail` | Pick tickets |
| `erp_mirror_aropen` / `_aropendt` | AR open items |
| `erp_mirror_print_transaction` / `_detail` | Print transactions |

### Read-model views (require `createServiceClient()`)

Built on top of the mirror tables; used by the app for PO workflows:

- `app_po_search` — summary rows with `system_id` = branch code
- `app_po_header` — full PO header with supplier name, totals, receiving counts
- `app_po_detail` — PO lines joined to item master and work orders
- `app_po_receiving_summary` — aggregate receiving stats per PO

All views already filter `is_deleted = false` internally.

Branch filtering uses `system_id = branch_code`. If a supervisor sees no open POs,
check that their `profiles.branch` value matches the `system_id` values in `app_po_search`.

---

## API Endpoints

| Endpoint | Method | Auth | Notes |
|----------|--------|------|-------|
| `/api/submissions` | GET | Session | Returns submissions filtered by role/branch |
| `/api/submissions` | POST | Session | Create new submission (worker) |
| `/api/submissions/[id]` | GET | Session | Fetch one submission |
| `/api/submissions/[id]` | PATCH | Supervisor/Admin/Manager | Update status & reviewer notes |
| `/api/po/[poNumber]` | GET | Session | Full PO detail (header + lines + receiving) |
| `/api/po/search` | GET | Session | Search POs |
| `/api/upload` | POST | Session | Upload image to S3; returns public URL + key |
| `/api/setup` | GET/POST/PATCH/DELETE | Secret key or Admin | User management |

---

## Admin Pages

After login, admins land on `/admin/users`. The admin section includes:

- `/admin/users` — Create, edit, delete users and assign roles/branches
- `/admin/open-pos` — View all open POs across all branches (ERP mirror)
- `/admin/submissions` — View and filter all submissions across all branches;
  clicking a row opens the submission detail at `/supervisor/{id}`

All admin pages share `web/app/admin/layout.tsx` which renders the green header,
nav links, display name, and a Sign Out button.

---

## Key Patterns

1. **Server vs client components**: Pages that need Supabase session data at render time
   (e.g. layouts, ERP data pages) are server components. Interactive filter/list pages
   are `'use client'` components that hit `/api/*` routes.

2. **`createServiceClient()` for ERP reads**: The `app_po_*` views require the service
   role key to bypass RLS. Using the anon/session client will return empty results or
   throw permission errors.

3. **Username → email convention**: All Supabase auth emails are `{username}@checkin.internal`.
   Helper functions `emailFromUsername` / `usernameFromEmail` are in `web/lib/utils.ts`.

4. **Multi-photo submissions**: The `image_url` field is kept for backward compatibility.
   New submissions use `image_urls` (array). Always check both when displaying photos.

5. **Real-time subscription pattern**: Client pages subscribe to `postgres_changes` on
   the `submissions` table via Supabase Realtime to auto-refresh without polling.

6. **Migrations**: Located in `supabase/migrations/`. Run via Supabase CLI or applied
   directly in the Supabase SQL editor. File names are dated prefixes.

---

## Common Pitfalls

- Forgetting to add `export const dynamic = 'force-dynamic'` to server pages that read
  auth sessions — without it, Next.js may statically render the page and miss the session.
- Using `createClient()` (anon) instead of `createServiceClient()` for ERP mirror queries —
  RLS will block the read and return empty data silently.
- Branch codes are case-sensitive in some queries. The app normalises to uppercase
  (`branch.trim().toUpperCase()`) before querying `system_id`.
- The `/api/setup` route uses a secret key for initial user creation (before any admin
  exists). Once an admin user exists, user management should go through `/admin/users`.
