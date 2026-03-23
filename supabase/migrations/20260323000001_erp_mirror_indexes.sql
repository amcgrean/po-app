-- Indexes on ERP mirror tables to prevent statement timeouts when the
-- app_po_* views are queried by po_id.
-- (po_number does not exist in the mirror tables; the views derive it
--  from po_id, so indexing po_id is sufficient.)

create index if not exists idx_erp_mirror_po_header_po_id
  on public.erp_mirror_po_header (po_id);

create index if not exists idx_erp_mirror_po_detail_po_id
  on public.erp_mirror_po_detail (po_id);

create index if not exists idx_erp_mirror_receiving_header_po_id
  on public.erp_mirror_receiving_header (po_id);

create index if not exists idx_erp_mirror_receiving_detail_po_id
  on public.erp_mirror_receiving_detail (po_id);
