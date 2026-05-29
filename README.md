# Young's Plan

Smartphone-first personal asset manager with separated PostgreSQL storage, backend calculations, ticker price refresh, and responsive charts.

## Structure

- `db/schema.sql` - PostgreSQL tables for accounts, assets, and valuation history.
- `backend/` - Express API, valuation logic, CRUD routes, and ticker refresh.
- `frontend/` - Vite React mobile-first UI with bottom tabs and charts.

## Setup

```bash
npm install
npm run db:create
npm run db:schema
npm run dev
```

The backend defaults to `http://localhost:4000`; the frontend defaults to `http://localhost:5173`.
With `VITE_API_BASE=auto`, the frontend calls port `4000` on the same host used to open the page. This supports both `localhost` on the PC and `http://192.168.0.4:5173` from a phone on the same network.

`npm run dev` first stops stale dev processes from this repository on ports `4000`, `5173`, and old fallback `5174`. Vite also uses a strict `5173` port so the phone URL stays stable.

## Database Setup

The app uses a dedicated PostgreSQL database named `youngs_plan`. The root `.env` should point at that database:

```dotenv
DATABASE_URL=postgresql:///youngs_plan?host=/var/run/postgresql
PORT=4000
VITE_API_BASE=auto
```

Create the database and apply the schema:

```bash
cp .env.example .env
npm run db:create
npm run db:schema
```

`npm run db:create` uses `createdb` and the database name from `DATABASE_URL`. `npm run db:schema` reads `DATABASE_URL` from the root `.env` file and applies `db/schema.sql`.

If `npm run db:create` fails with `permission denied to create database`, the current PostgreSQL role does not have `CREATEDB`. Ask an administrator to create the app database:

```bash
sudo -u postgres createdb -O young youngs_plan
```

Then run:

```bash
npm run db:schema
```

For password-based TCP access, use this form instead:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/DB_NAME
```

Do not use the existing `MacroX` database as the default for this app. Any old `asset_accounts` or `asset_items` tables in `MacroX` are legacy test data and are not part of the app setup.

## Core Workflow

1. Add accounts such as brokerage, bank, real estate, or bond accounts.
2. Register assets by type: stock, real estate, cash, or bond.
3. For stocks, enter average cost, quantity, currency, and KRW exchange rate for USD holdings.
4. For stocks, enter a company name and choose `국내` or `미국`; the form searches matching tickers such as `005930.KS` or `AAPL`.
5. For US assets, USD is the default display currency. The form auto-fills the purchase-date USD/KRW rate and current USD/KRW rate; the price refresh button updates the current rate with the latest quote.
6. Optionally enter a ticker manually. The price refresh button uses Yahoo Finance first and Stooq as a fallback for supported symbols; unsupported symbols keep the manual price and show an error on the asset.
7. Use `매수일` for the purchase date. Turn on `매도 제한` only when the asset cannot be sold immediately, then set the sale-available date.
8. Choose a target date and range to see total value, cash-convertible value, locked value, profit/loss, allocation, pie chart, and liquidity projection charts.

## Editing Data

Use the bottom tabs:

- `요약` - dashboard, allocation, return rate, chart, and ticker refresh.
- `자산` - create, edit, or delete assets.
- `계좌` - create, edit, or delete accounts. Deleting an account also deletes connected assets.

After schema changes, always run:

```bash
npm run db:schema
```
