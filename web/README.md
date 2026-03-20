# PO Check-In Merged Web App

This is the new merged web-app workspace being built inside the existing `po-checkin-app` folder.

## Current intent

- use the `po-pics` Next.js app as the web foundation
- point PO lookup at the shared `agility_api` Supabase database
- gradually absorb the old Electron PO check-in sheet workflows

## Status

- active application workspace
- no database migrations or view SQL have been applied yet

## Expected database target

This app is intended to read PO data from the shared Supabase/Postgres database already used by `agility_api`, using app-facing views such as:

- `app_po_search`
- `app_po_header`
- `app_po_detail`
- `app_po_receiving_summary`

## Next steps

1. review and apply the draft read-model SQL in the `api` repo when ready
2. finish wiring the worker and supervisor flows to the shared PO views
3. add app-owned tables for check-ins and acknowledgement reviews
