# Shop Management API — Backend (Phase 1: foundation, Stock, Products, Suppliers, Sales/POS, Institutions)

Node.js + Express + PostgreSQL (via Knex). This is the first working slice of the
system: authentication, RBAC, and the full Stock module. Suppliers, Sales/POS,
Institutions, and Analytics get added the same way in the next steps.

## What's included

- **Auth & RBAC**: `roles`, `permissions`, `role_permissions`, `users`. JWT login.
  A store manager/admin can create employee accounts via `POST /api/auth/employees`.
- **Stock module** (fully working):
  - `stock_in`, `damaged`, `transfer` (store room ↔ front shelf) all update
    `stock_levels` (fast read) and `stock_movements` (audit trail) atomically.
  - Reporting damage also auto-logs a `shrinkage_records` row, so the analytics
    module (built later) has data from day one.
- **Products & Categories module** (fully working):
  - Full CRUD, soft-delete on products (keeps history in sales/movements intact).
  - `GET /api/products?search=&category_id=&low_stock=true` — the `low_stock`
    filter compares total quantity across all locations to `reorder_level`.
  - Selling price changes are locked to users with `pricing.manage` (store
    manager/admin) even though store keepers can otherwise manage products —
    this is the "cashier/store keeper can't touch prices" rule from the spec,
    enforced in code, not just in the UI.
  - SKU is immutable after creation (avoids breaking historical references in
    stock movements and sales).
- **Suppliers module** (fully working):
  - Recording a delivery (`POST /api/supplier-deliveries`) atomically creates
    the delivery, its line items, AND the matching `stock_in` movements into
    the store room — a delivery can never exist without matching stock, or
    vice versa.
  - Payments are tracked separately from deliveries and recompute the
    delivery's `unpaid`/`partial`/`paid` status automatically.
  - `GET /api/supplier-deliveries/unpaid-summary` gives the total balance owed
    per supplier, for the "which suppliers are we behind on" view.
  - RBAC split: store keepers can record deliveries (`supplier_deliveries.manage`)
    since that's a physical stock event, but recording a *payment*
    (`supplier_payments.manage`) is restricted to the store manager/admin,
    since that's money leaving the business. Both can *view* payment status.
- **Sales/POS module** (fully working):
  - Cash drawer sessions (`POST /api/cash-drawer/open`, `.../close`): a
    cashier can only have one open session at a time, and closing computes
    `expected_balance` from cash-only completed sales in that session, plus
    the `variance` against what was actually counted — so shortfalls surface
    automatically.
  - Sales deduct stock atomically per item; if any item has insufficient
    stock the entire sale rolls back (tested — an oversell attempt leaves
    stock completely untouched, not partially decremented).
  - Voiding a sale (`sales.void`, manager-only) restocks every item it
    contained.
  - Returns (`POST /api/returns`) can restock the item (goes back on the
    shelf) or write it off (stock stays deducted, no shelf return) depending
    on the `restocked` flag.
  - A cashier cannot sell against a closed drawer, cannot close someone
    else's drawer, and cannot void sales — all enforced in code and verified
    against a live database, not just assumed from the route guards.
- **Institutions module** (fully working):
  - Mirrors the Suppliers pattern but in reverse: an order deducts stock from
    the store room immediately (goods are dispatched), with a separate
    `delivery_status` flag (`pending`/`delivered`) for logistics tracking
    that does NOT re-touch stock.
  - Line items carry their own `unit_price`, so institutions can get a
    negotiated bulk rate different from the regular shelf price.
  - Added a migration for `institution_payments` (the original schema had
    `amount_paid` on the order but no payment history table — added for
    parity with Suppliers and so partial payments are auditable).
  - Same RBAC split as Suppliers: store keepers create/dispatch orders,
    but recording a payment *received* is restricted to the store
    manager/admin. Tested end-to-end: 100 units at a 700/unit negotiated
    rate → stock dropped 500→400, a 30,000 partial payment left exactly
    40,000 owed, and a second payment of 40,000 flipped status to `paid`
    and cleared the institution from the unpaid summary.
- **Full database schema migrations** for every module discussed (suppliers,
  institutions, sales/POS, cash drawer, returns, shrinkage) — tables exist even
  though only Stock has routes/controllers so far, so nothing has to be
  re-modeled later.

## Setup

1. Install PostgreSQL locally (or use a hosted instance) and create a database:
   ```
   createdb shop_management
   ```
2. Copy `.env.example` to `.env` and fill in your DB credentials and a real
   `JWT_SECRET`.
3. Install dependencies:
   ```
   npm install
   ```
4. Run migrations, then seed roles/permissions/admin user:
   ```
   npm run migrate
   npm run seed
   ```
5. Start the API:
   ```
   npm run dev
   ```
   It runs on `http://localhost:4000` by default.

## Default login

After seeding, log in with:
- email: `admin@shop.local`
- password: `ChangeMe123!`

**Change this password immediately** — either add a "change password" endpoint
next, or update it directly in the database for now.

## Try it

```bash
# Login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@shop.local","password":"ChangeMe123!"}'

# Use the returned token for authenticated requests
curl http://localhost:4000/api/stock/levels \
  -H "Authorization: Bearer <token>"
```

You'll need at least one product in the `products` table before stock intake
will do anything useful — that endpoint comes with the next module.

## Project structure

```
shop-backend/
  src/
    config/db.js          # knex connection
    migrations/            # full DB schema, one file per module
    seeds/                 # roles, permissions, default admin
    middleware/
      auth.js               # verifies JWT, loads user + permissions
      rbac.js                # requirePermission(...) route guard
    models/
      stockService.js        # transactional stock movement logic
    controllers/            # request handlers per module
    routes/                  # route definitions per module
    app.js                  # express app wiring
  server.js                # entry point
  knexfile.js               # DB config for migrations/seeds
```

## Next steps (in order)

1. ~~Products & categories CRUD~~ ✅ done
2. ~~Suppliers module~~ ✅ done
3. ~~Sales/POS module~~ ✅ done
4. ~~Institutions module~~ ✅ done
5. **Analytics module**: sales analysis, shrinkage analysis (shrinkage_records is already being populated)
6. **React POS client** (frontend) — in progress in the separate `posclient` project: login, product grid, and Suppliers screen (list, create, record delivery, record payment, unpaid summary) are done. Cart/checkout on the Sales screen is still pending.
7. **Mobile app** (React Native) and **Desktop app** (Electron)

## Note: permissions now included in the login response

`POST /api/auth/login` now returns `user.permissions` (an array of permission
codes), not just `role`. This was added to support the frontend showing/hiding
buttons based on what the logged-in user can actually do (e.g. a store keeper
sees "record delivery" but not "record payment"). The lookup logic lives in
`src/utils/permissions.js`, shared between the auth middleware and the login
controller so it isn't duplicated.

Say which one you want built next and we'll keep going in this same pattern:
migration (if needed) → service/model → controller → routes → wired into `app.js`.
