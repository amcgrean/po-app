-- Create RPC functions used by the web app for PO data retrieval.
--
-- get_branch_open_pos: returns lightweight open-PO list for a branch.
--   Queries erp_mirror_po_header directly (not through the view) so that
--   the index on system_id is used and the query stays fast.
--
-- get_po_detail: returns full PO detail (header + lines + receiving summary)
--   as a single JSON object, keyed by po_id.

-- ────────────────────────────────────────────────────────────────────
-- 1. get_branch_open_pos
-- ────────────────────────────────────────────────────────────────────

create or replace function public.get_branch_open_pos(
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
  order by h.expect_date asc nulls last,
           h.order_date  desc nulls last
  limit row_limit;
$$;

grant execute on function public.get_branch_open_pos(text, integer)
  to service_role, authenticated, anon;

-- ────────────────────────────────────────────────────────────────────
-- 2. get_po_detail
-- ────────────────────────────────────────────────────────────────────
-- Returns a JSON object: { header, lines, receiving_summary }
-- Only filter_col = 'po_id' is currently supported.

create or replace function public.get_po_detail(
  filter_col text,
  filter_val text
)
returns jsonb
language plpgsql
security definer
stable
as $$
declare
  v_header    jsonb;
  v_lines     jsonb;
  v_receiving jsonb;
begin
  if filter_col <> 'po_id' then
    raise exception
      'Unsupported filter_col: %. Only po_id is supported.', filter_col;
  end if;

  select to_jsonb(h)
  into   v_header
  from   public.app_po_header h
  where  h.po_id = filter_val::bigint
  limit  1;

  if v_header is null then
    return null;
  end if;

  select jsonb_agg(to_jsonb(d) order by d.line_number)
  into   v_lines
  from   public.app_po_detail d
  where  d.po_id = filter_val::bigint;

  select to_jsonb(r)
  into   v_receiving
  from   public.app_po_receiving_summary r
  where  r.po_id = filter_val::bigint
  limit  1;

  return jsonb_build_object(
    'header',           v_header,
    'lines',            coalesce(v_lines, '[]'::jsonb),
    'receiving_summary', v_receiving
  );
end;
$$;

grant execute on function public.get_po_detail(text, text)
  to service_role, authenticated, anon;
