-- Fix get_branch_open_pos: filter closed/complete/received statuses inside
-- the RPC so the row_limit cap applies only to genuinely open POs.
--
-- Previously the RPC returned up to row_limit rows regardless of status and
-- relied on JS-side filtering, which caused 0 results when the first
-- row_limit rows for a branch were all closed/historical POs.

drop function if exists public.get_branch_open_pos(text, integer);

create function public.get_branch_open_pos(
  branch_id  text,
  row_limit  integer default 500
)
returns table (
  po_id         bigint,
  system_id     text,
  supplier_key  text,
  purchase_type text,
  order_date    text,
  expect_date   text,
  po_status     text,
  wms_status    text,
  reference     text,
  synced_at     text
)
language sql
security definer
stable
as $$
  select
    h.po_id::bigint,
    h.system_id::text,
    h.supplier_key::text,
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
    -- exclude po_status values that are considered closed
    and (
      h.po_status is null
      or (
        h.po_status not ilike '%closed%'
        and h.po_status not ilike '%complete%'
        and h.po_status not ilike '%cancel%'
        and h.po_status not ilike '%void%'
        and h.po_status not ilike '%received%'
      )
    )
    -- exclude wms_status values that are considered closed
    and (
      h.wms_status is null
      or (
        h.wms_status not ilike '%closed%'
        and h.wms_status not ilike '%complete%'
        and h.wms_status not ilike '%cancel%'
        and h.wms_status not ilike '%void%'
        and h.wms_status not ilike '%received%'
      )
    )
  order by h.expect_date asc nulls last,
           h.order_date  desc nulls last
  limit row_limit;
$$;

grant execute on function public.get_branch_open_pos(text, integer)
  to service_role, authenticated, anon;
