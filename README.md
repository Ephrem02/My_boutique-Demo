# Shop Management System

One project, two apps, matching the original architecture: Node.js + PostgreSQL
API (`backend/`) and a React POS client (`posclient/`). Mobile and desktop apps
will land as further subfolders here later, sharing the same `backend/` API.

```
shop-management-system/
  backend/      Node.js + Express + PostgreSQL API
  posclient/    React (Vite) frontend - cashier/manager screens
```

## Quick start

**1. Backend** (do this first — the frontend needs it running)

```bash
cd backend
cp .env.example .env      # fill in your Postgres credentials + a real JWT_SECRET
npm install
npm run migrate
npm run seed
npm run dev                # http://localhost:4000
```

**2. Frontend**

```bash
cd posclient
cp .env.example .env      # defaults to http://localhost:4000/api, fine as-is
npm install
npm run dev                # http://localhost:5173
```

Log in with the seeded admin: `admin@shop.local` / `ChangeMe123!` — change
this immediately in a real deployment.

## What's built so far

| Module | Backend | Frontend |
|---|---|---|
| Auth & RBAC | ✅ | ✅ (login, permission-aware nav/buttons) |
| Stock (intake, transfer, damage) | ✅ | — |
| Products & Categories | ✅ | — |
| Suppliers (deliveries, payments, unpaid tracking) | ✅ | ✅ |
| Sales/POS (cash drawer, sales, returns) | ✅ | 🟡 product grid only — cart/checkout pending |
| Institutions (bulk/credit orders) | ✅ | — |
| Analytics (sales, shrinkage) | — | — |

Each subfolder has its own README with full details, endpoint lists, and a
"next steps" section specific to that app. This root README is the map;
the subfolder READMEs are the manual for each part.

## Why two folders instead of one

They're separate npm projects (different dependencies, different run
commands, different deploy targets — the API goes on a server, the POS
client gets built to static files or run as a desktop/mobile shell later).
Keeping them as sibling folders under one root is the standard shape for
this: everything lives in one place you can put under one git repo, but
each app still installs and runs independently.

## Continuing this build

Whether here in chat or handed to Claude Code, always work from inside this
`shop-management-system/` root so both apps stay in the same place — don't
let `backend` or `posclient` drift into separate project folders again.
