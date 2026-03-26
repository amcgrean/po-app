-- Fix 1: add supplier_name to get_branch_open_pos so the PO list shows
--         the supplier's human-readable name instead of the raw key.
--
-- Fix 2: create/replace app_po_detail view to join erp_mirror_po_detail
--         to erp_mirror_item so that item_code (i.item) is populated on
--         every PO detail line.  Without this join the item_code column
--         is always null because erp_mirror_po_detail stores only item_ptr.

-- ────────────────────────────────────────────────────────────────────
-- 1. get_branch_open_pos  (add supplier_name)
-- ────────────────────────────────────────────────────────────────────
drop function if exists public.get_branch_open_pos(text, integer);

create or replace function public.get_branch_open_pos(
  branch_id  text,
  row_limit  integer default 500
)
returns table (
  po_id          bigint,
  system_id      text,
  supplier_key   text,
  supplier_name  text,
  purchase_type  text,
  order_date     text,
  expect_date    text,
  po_status      text,
  wms_status     text,
  reference      text,
  synced_at      text
)
language sql
security definer
stable
as $$
  select
    h.po_id::bigint,
    h.system_id::text,
    h.supplier_key::text,
    h.supplier_name::text,
    h.purchase_type::text,
    h.order_date::text,
    h.expect_date::text,
    h.po_status::text,
    h.wms_status::text,
    h.reference::text,
    h.synced_at::text
  from public.erp_mirror_po_header h
  where h.system_id = branch_id
    and coalesce(h.is_deleted, false) = false
  order by h.expect_date asc nulls last,
           h.order_date  desc nulls last
  limit row_limit;
$$;

grant execute on function public.get_branch_open_pos(text, integer)
  to service_role, authenticated, anon;

-- ────────────────────────────────────────────────────────────────────
-- 2. app_po_detail view  (join to erp_mirror_item for item_code)
-- ────────────────────────────────────────────────────────────────────
-- Joins erp_mirror_po_detail (which only carries item_ptr) to
-- erp_mirror_item so that item_code and description are resolved from
-- the item master rather than being null.
create or replace view public.app_po_detail as
select
  d.system_id,
  d.po_id,
  d.po_number,
  d.sequence                             as line_number,
  d.item_ptr,
  i.item                                 as item_code,
  i.description,
  i.size_,
  d.qty_ordered,
  d.uom,
  d.cost,
  null::numeric                          as disp_cost_conv,
  null::text                             as display_cost_uom,
  (d.qty_ordered * d.cost)               as extended_total,
  d.po_status,
  null::boolean                          as canceled,
  null::text                             as due_date,
  d.expect_date,
  null::text                             as exp_rcpt_date,
  null::text                             as exp_ship_date,
  d.wo_id,
  null::text                             as wo_status,
  null::text                             as wo_department,
  null::text                             as wo_branch_code,
  d.source_updated_at,
  d.synced_at
from public.erp_mirror_po_detail d
left join public.erp_mirror_item i on i.item_ptr = d.item_ptr
where coalesce(d.is_deleted, false) = false;
