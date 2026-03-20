# PO App

This repository now contains the active PO web application in the `web/` directory.

## Working directory

- Use `web/` for development, builds, and runtime commands.
- Root-level legacy Electron files and stray environment artifacts were removed so this repo stays focused on the web app.

## Quick start

```bash
cd web
npm install
npm run dev
```

## Environment setup

Copy `web/.env.local.example` to `web/.env.local` and fill in the required values before running the app. The setup/user-management flow also requires `SUPABASE_SERVICE_ROLE_KEY` in the web app runtime environment; `SETUP_SECRET` is only checked by this web app and does not belong in Supabase/Postgres itself.

## Main scripts

```bash
cd web
npm run dev
npm run build
npm run start
```
