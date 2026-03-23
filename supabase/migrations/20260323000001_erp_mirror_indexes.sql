-- Indexes on ERP mirror tables to prevent statement timeouts when the
-- app_po_* views are queried by po_number / po_id.

-- po_header
create index if not exists idx_erp_mirror_po_header_po_number
  on public.erp_mirror_po_header (po_number);

create index if not exists idx_erp_mirror_po_header_po_id
  on public.erp_mirror_po_header (po_id);

-- po_detail (largest table — most critical)
create index if not exists idx_erp_mirror_po_detail_po_number
  on public.erp_mirror_po_detail (po_number);

create index if not exists idx_erp_mirror_po_detail_po_id
  on public.erp_mirror_po_detail (po_id);

-- receiving_header
create index if not exists idx_erp_mirror_receiving_header_po_number
  on public.erp_mirror_receiving_header (po_number);

create index if not exists idx_erp_mirror_receiving_header_po_id
  on public.erp_mirror_receiving_header (po_id);

-- receiving_detail
create index if not exists idx_erp_mirror_receiving_detail_po_number
  on public.erp_mirror_receiving_detail (po_number);

create index if not exists idx_erp_mirror_receiving_detail_po_id
  on public.erp_mirror_receiving_detail (po_id);
