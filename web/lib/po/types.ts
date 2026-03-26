export interface PoSearchRow {
  system_id: string | null
  po_id: number
  po_number: string
  purchase_type: string | null
  supplier_key: string | null
  supplier_name: string | null
  supplier_city: string | null
  supplier_state: string | null
  branch_code: string | null
  order_date: string | null
  expect_date: string | null
  due_date: string | null
  buyer: string | null
  reference: string | null
  ship_via: string | null
  po_status: string | null
  wms_status: string | null
  po_total: number | null
  line_count: number | null
  receipt_count: number | null
  last_receive_date: string | null
  qty_received_total: number | null
  synced_at: string | null
}

export interface PoHeaderRow {
  system_id: string | null
  po_id: number
  po_number: string
  purchase_type: string | null
  supplier_key: string | null
  shipfrom_seq: number | null
  supplier_name: string | null
  supplier_city: string | null
  supplier_state: string | null
  supplier_branch_code: string | null
  order_date: string | null
  expect_date: string | null
  due_date: string | null
  buyer: string | null
  reference: string | null
  ship_via: string | null
  current_receive_no: number | null
  po_status: string | null
  wms_status: string | null
  received_manually: boolean | null
  mwt_recv_complete: boolean | null
  mwt_recv_complete_datetime: string | null
  po_total: number | null
  line_count: number | null
  receipt_count: number | null
  first_receive_date: string | null
  last_receive_date: string | null
  qty_received_total: number | null
  created_date: string | null
  update_date: string | null
  source_updated_at: string | null
  synced_at: string | null
}

export interface PoDetailRow {
  system_id: string | null
  po_id: number
  po_number: string
  line_number: number
  item_ptr: number | null
  item_code: string | null
  description: string | null
  size_: string | null
  qty_ordered: number | null
  uom: string | null
  cost: number | null
  disp_cost_conv: number | null
  display_cost_uom: string | null
  extended_total: number | null
  po_status: string | null
  canceled: boolean | null
  due_date: string | null
  expect_date: string | null
  exp_rcpt_date: string | null
  exp_ship_date: string | null
  wo_id: number | null
  wo_status: string | null
  wo_department: string | null
  wo_branch_code: string | null
  created_date: string | null
  update_date: string | null
  source_updated_at: string | null
  synced_at: string | null
}

export interface PoReceivingSummaryRow {
  system_id: string | null
  po_id: number
  po_number: string
  receipt_count: number | null
  first_receive_date: string | null
  last_receive_date: string | null
  qty_received_total: number | null
  latest_recv_status: string | null
}

export interface PoLookupResult {
  header: PoHeaderRow | null
  detail: PoDetailRow[]
  receiving: PoReceivingSummaryRow | null
}

/** Lightweight row returned by the branch open-PO list. Sourced directly from
 *  erp_mirror_po_header (no joins) so the query is fast and reliably filtered. */
export interface OpenPoListRow {
  po_id: number
  system_id: string | null
  supplier_key: string | null
  supplier_name: string | null
  purchase_type: string | null
  order_date: string | null
  expect_date: string | null
  po_status: string | null
  wms_status: string | null
  reference: string | null
  synced_at: string | null
}
