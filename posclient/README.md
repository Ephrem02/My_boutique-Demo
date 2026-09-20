# MY Boutique — React frontend

React + Vite client for the shop management API. Talks to the `shop-backend`
project over REST with JWT auth.

## What's included

- **Auth**: login page, JWT + user (with `permissions` array) persisted to
  localStorage, `useAuth()` hook with a `hasPermission(...)` helper used
  throughout to show/hide actions based on the logged-in user's role.
- **Suppliers screen** (fully working): list, create supplier, unpaid-balance
  summary cards, and a slide-over detail panel per supplier for recording
  deliveries (with dynamic line items and a live total) and payments. Buttons
  are permission-gated — e.g. a store keeper sees "record delivery" but not
  "record payment," matching the backend's RBAC exactly.
- **Sales/POS screen** (in progress): the product grid (search, tap-to-add,
  low-stock highlighting) works and is wired to `GET /api/products`. The cart
  panel and checkout flow are not built yet — this is the next thing to pick
  up.
- **Layout & routing**: permission-aware nav (only shows links the user can
  actually use), protected routes that redirect to `/login` if not
  authenticated.

## Setup

1. Make sure `shop-backend` is running (see its own README) and its `.env`
   has `CORS_ORIGINS` including `http://localhost:5173`.
2. Copy `.env.example` to `.env` — defaults to `http://localhost:4000/api`.
3. `npm install`
4. `npm run dev` — runs on `http://localhost:5173`

Log in with the seeded admin: `admin@shop.local` / `ChangeMe123!` (or any
employee account created via the Suppliers/Users flow once that exists).

## Project structure

```
posclient/
  src/
    api/client.js          # axios instance, attaches JWT, unwraps API error messages
    context/AuthContext.jsx  # login/logout, hasPermission(...)
    components/
      Layout.jsx              # topbar + permission-aware nav
      ProductGrid.jsx          # tap-to-add product tiles, debounced search
      OpenDrawerModal.jsx / CloseDrawerModal.jsx
      CreateSupplierModal.jsx
      RecordDeliveryModal.jsx  # dynamic line items, live total
      RecordPaymentModal.jsx
      SupplierDetail.jsx       # slide-over panel: deliveries + actions
    pages/
      LoginPage.jsx
      POSPage.jsx             # product grid done; cart/checkout still TODO
      Suppliers.jsx           # done
    App.jsx                 # routes
    main.jsx                # entry point
    styles.css              # design tokens + all component styles
```

## Design notes

This is a working retail terminal, not a marketing site, so the layout
follows real POS conventions (product grid + cart panel, big tap targets) —
see `styles.css` for the token system: warm off-white surface, one deep-green
accent reserved for money-positive actions (complete sale, paid), amber only
for low-stock/attention states. Numbers use tabular figures so prices and
quantities align.

## Next steps

1. **Finish the Sales/POS screen**: Cart.jsx (add/remove items, quantity
   adjust, payment method selection, checkout against `POST /api/sales`).
2. **Institutions screen** — same pattern as Suppliers, reversed (orders
   instead of deliveries, but same shape).
3. **Products & Categories management screen** for store keepers/managers.
4. **Analytics dashboard** once the backend module exists.
5. **User management screen** (create employee accounts, deactivate/reactivate)
   — the backend already supports `POST/GET /api/auth/employees`; a
   `PATCH /api/auth/employees/:id` to toggle status doesn't exist yet and
   would need to be added first.
