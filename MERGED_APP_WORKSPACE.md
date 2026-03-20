# Merged App Workspace

This folder now contains two tracks:

- the legacy Electron desktop app at the repo root
- the new merged web app under [`web`](C:/Users/amcgrean/python/po-checkin-app/web)

## Why this layout

- the desktop app is still useful as a reference for acknowledgement review, printing, and legacy workflows
- the new web app can be built locally without disturbing the old files
- once the web app is ready, this folder can become the source for a brand-new GitHub repo

## Current local additions

- [`web/package.json`](C:/Users/amcgrean/python/po-checkin-app/web/package.json)
- [`web/lib/po/server.ts`](C:/Users/amcgrean/python/po-checkin-app/web/lib/po/server.ts)
- [`web/lib/po/types.ts`](C:/Users/amcgrean/python/po-checkin-app/web/lib/po/types.ts)
- [`web/app/api/po/search/route.ts`](C:/Users/amcgrean/python/po-checkin-app/web/app/api/po/search/route.ts)
- [`web/app/api/po/[poNumber]/route.ts`](C:/Users/amcgrean/python/po-checkin-app/web/app/api/po/[poNumber]/route.ts)

## Important note

The PO API routes expect the shared Supabase database to eventually contain the app-facing views drafted in:

- [`C:\Users\amcgrean\python\api\sql\app_po_read_models.sql`](C:\Users\amcgrean\python\api\sql\app_po_read_models.sql)

Those views have not been applied yet, so the new PO lookup code currently fails softly and keeps the worker flow usable during local development.
