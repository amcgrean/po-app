-- Drop stale flat tables that have been fully replaced by erp_mirror_* tables.
--
-- These tables were part of an early prototype sync and have been empty (0 rows)
-- since the ERP worker was switched to the erp_mirror schema.  All application
-- queries already use the erp_mirror tables or the app_po_* read-model views.
--
-- Mapping (old → new):
--   customers          → erp_mirror_cust
--   sales_orders       → erp_mirror_so_header
--   sales_order_lines  → erp_mirror_so_detail
--   inventory          → erp_mirror_item + erp_mirror_item_branch
--   dispatch_orders    → erp_mirror_shipments_header

DROP TABLE IF EXISTS public.customers;
DROP TABLE IF EXISTS public.sales_order_lines;   -- drop child before parent
DROP TABLE IF EXISTS public.sales_orders;
DROP TABLE IF EXISTS public.inventory;
DROP TABLE IF EXISTS public.dispatch_orders;
