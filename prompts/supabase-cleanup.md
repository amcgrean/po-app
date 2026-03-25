# Supabase Cleanup Prompt — agility-api project

Use this prompt to audit and clean up stale tables in the agility-api Supabase project
(`vyatosniqboeqzadyqmr`). Run it in a Claude session that has access to the Supabase MCP tools.

---

## Prompt

You are auditing the **agility-api** Supabase project (`vyatosniqboeqzadyqmr`) for stale tables
that can be safely dropped. Follow these steps exactly.

### Step 1 — Inventory

Run the following query and record every table name, row count, and RLS status:

```sql
SELECT
  schemaname,
  tablename,
  n_live_tup AS approx_rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC, tablename;
```

### Step 2 — Code reference check

For each table returned, search the following repositories for any `.from('table_name')` calls,
raw SQL references, or ORM model names:

- `amcgrean/po-app` (Next.js PO check-in app)
- `amcgrean/WH-Tracker` (Flask warehouse tracker)
- Any ERP worker / sync scripts that write to Supabase

Mark each table as **Referenced** or **Unreferenced**.

### Step 3 — Classify each table

Apply these rules:

| Rule | Action |
|------|--------|
| Table is `erp_mirror_*` with data (rows > 0) | **Keep** — canonical ERP mirror |
| Table is `erp_mirror_*` with 0 rows | **Keep for now** — may receive data later; flag for review |
| Table is `app_po_*` (view) | **Keep** — used by po-app detail pages |
| Table is `profiles` or `submissions` | **Keep** — core po-app tables |
| Table has 0 rows AND no code references AND predates erp_mirror schema | **Candidate to drop** |
| Table has rows but no code references | **Flag for human review before dropping** |
| Table is `alembic_version` | **Keep** if any Python worker uses Alembic migrations; else drop |
| Table is `erp_sync_*` | **Keep** — used by ERP worker to track sync state |

### Step 4 — Propose migration

For each **Candidate to drop** table, generate a `DROP TABLE IF EXISTS` statement.
**Do not execute yet.** Present the full migration SQL to the user for review:

```sql
-- Proposed cleanup migration
-- Generated: <date>
-- Tables confirmed to have 0 rows and no code references

DROP TABLE IF EXISTS public.<table_name>;
-- ... one per table
```

### Step 5 — Confirm and apply

Only after the user explicitly approves the proposed SQL:

1. Apply it using `apply_migration` with name `cleanup_stale_tables_<YYYYMMDD>`
2. Verify each table no longer exists with:
   ```sql
   SELECT tablename FROM pg_tables
   WHERE schemaname = 'public'
   AND tablename IN ('<dropped_tables>');
   ```
3. Save the final migration SQL to `supabase/migrations/<timestamp>_cleanup_stale_tables.sql`
   in the `po-app` repo and commit it to the `main` branch.

---

## Known state as of 2026-03-25

Already dropped (migration `20260325000000_drop_stale_flat_tables.sql`):
- `customers`, `sales_orders`, `sales_order_lines`, `inventory`, `dispatch_orders`

Confirmed active — do not drop:
- All `erp_mirror_*` tables with rows
- `erp_sync_state`, `erp_sync_batches`, `erp_sync_table_state`
- `profiles`, `submissions`
- `app_po_search`, `app_po_header`, `app_po_detail`, `app_po_receiving_summary` (views)
- `pickster`, `PickTypes`, `pick` — active pick workflow (rows present)
- `audit_events` — active (5 rows)

Flagged for review (0 rows, possibly stale):
- `credit_images`
- `customer_notes`
- `work_orders` (shadowed by `erp_mirror_wo_header`)
- `pick_assignments` (shadowed by `erp_mirror_pick_*`)
- `alembic_version` (1 row — check if any Python worker uses Alembic)
- `erp_mirror_aropen`, `erp_mirror_aropendt` (0 rows — synced but empty)
- `erp_mirror_print_transaction`, `erp_mirror_print_transaction_detail` (0 rows)
