CREATE TABLE IF NOT EXISTS asset_accounts (
  id text PRIMARY KEY,
  name text NOT NULL,
  institution text,
  liquidity_restricted boolean NOT NULL DEFAULT false,
  liquidity_unlock_date date,
  liquidity_restriction_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_accounts
  ADD COLUMN IF NOT EXISTS liquidity_restricted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS liquidity_unlock_date date,
  ADD COLUMN IF NOT EXISTS liquidity_restriction_reason text;

CREATE TABLE IF NOT EXISTS asset_items (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES asset_accounts(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('stock', 'real_estate', 'cash', 'bond', 'dividend')),
  name text NOT NULL,
  market text NOT NULL DEFAULT 'domestic' CHECK (market IN ('domestic', 'us', 'other')),
  ticker text,
  currency text NOT NULL DEFAULT 'KRW',
  quantity numeric,
  average_cost numeric,
  current_value numeric,
  valuation_date date NOT NULL DEFAULT CURRENT_DATE,
  purchase_fx_rate_to_krw numeric NOT NULL DEFAULT 1,
  fx_rate_to_krw numeric NOT NULL DEFAULT 1,
  price_source text NOT NULL DEFAULT 'manual' CHECK (price_source IN ('manual', 'yahoo', 'stooq')),
  last_price_at timestamptz,
  last_price_error text,
  liquid_from date NOT NULL,
  maturity_date date,
  maturity_amount numeric,
  maturity_currency text,
  maturity_fx_rate_to_krw numeric,
  auto_convert_on_maturity boolean NOT NULL DEFAULT true,
  matured_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_items
  ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'domestic',
  ADD COLUMN IF NOT EXISTS ticker text,
  ADD COLUMN IF NOT EXISTS valuation_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS purchase_fx_rate_to_krw numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_price_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_price_error text,
  ADD COLUMN IF NOT EXISTS maturity_date date,
  ADD COLUMN IF NOT EXISTS maturity_amount numeric,
  ADD COLUMN IF NOT EXISTS maturity_currency text,
  ADD COLUMN IF NOT EXISTS maturity_fx_rate_to_krw numeric,
  ADD COLUMN IF NOT EXISTS auto_convert_on_maturity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS matured_at timestamptz;

ALTER TABLE asset_items
  DROP CONSTRAINT IF EXISTS asset_items_type_check,
  ADD CONSTRAINT asset_items_type_check CHECK (type IN ('stock', 'real_estate', 'cash', 'bond', 'dividend'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'asset_items_market_check'
  ) THEN
    ALTER TABLE asset_items
      ADD CONSTRAINT asset_items_market_check CHECK (market IN ('domestic', 'us', 'other'));
  END IF;
END $$;

ALTER TABLE asset_items
  DROP CONSTRAINT IF EXISTS asset_items_price_source_check,
  ADD CONSTRAINT asset_items_price_source_check CHECK (price_source IN ('manual', 'yahoo', 'stooq'));

UPDATE asset_items
SET purchase_fx_rate_to_krw = fx_rate_to_krw
WHERE purchase_fx_rate_to_krw = 1
  AND fx_rate_to_krw <> 1;

CREATE TABLE IF NOT EXISTS asset_value_history (
  asset_id text NOT NULL REFERENCES asset_items(id) ON DELETE CASCADE,
  valuation_date date NOT NULL,
  current_value numeric,
  value_krw numeric NOT NULL,
  cost_krw numeric NOT NULL,
  purchase_fx_rate_to_krw numeric NOT NULL DEFAULT 1,
  fx_rate_to_krw numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, valuation_date)
);

ALTER TABLE asset_value_history
  ADD COLUMN IF NOT EXISTS purchase_fx_rate_to_krw numeric NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS asset_items_account_id_idx ON asset_items(account_id);
CREATE INDEX IF NOT EXISTS asset_items_liquid_from_idx ON asset_items(liquid_from);
CREATE INDEX IF NOT EXISTS asset_items_type_idx ON asset_items(type);
CREATE INDEX IF NOT EXISTS asset_items_market_idx ON asset_items(market);
CREATE INDEX IF NOT EXISTS asset_items_ticker_idx ON asset_items(ticker);
CREATE INDEX IF NOT EXISTS asset_items_maturity_date_idx ON asset_items(maturity_date);
CREATE INDEX IF NOT EXISTS asset_value_history_valuation_date_idx ON asset_value_history(valuation_date);

CREATE TABLE IF NOT EXISTS asset_price_history (
  market text NOT NULL,
  ticker text NOT NULL,
  price_date date NOT NULL,
  close_price numeric NOT NULL,
  currency text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, ticker, price_date)
);

CREATE INDEX IF NOT EXISTS asset_price_history_price_date_idx ON asset_price_history(price_date);

CREATE TABLE IF NOT EXISTS fx_rate_history (
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  rate_date date NOT NULL,
  rate numeric NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (base_currency, quote_currency, rate_date)
);

CREATE INDEX IF NOT EXISTS fx_rate_history_rate_date_idx ON fx_rate_history(rate_date);

CREATE TABLE IF NOT EXISTS simulation_incomes (
  id text PRIMARY KEY,
  account_id text REFERENCES asset_accounts(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('monthly', 'one_time')),
  name text NOT NULL,
  amount_krw numeric NOT NULL CHECK (amount_krw > 0),
  start_date date NOT NULL,
  end_date date,
  repeats_indefinitely boolean NOT NULL DEFAULT false,
  availability text NOT NULL CHECK (availability IN ('immediate', 'unlock_date', 'unavailable')),
  unlock_date date,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE simulation_incomes
  ADD COLUMN IF NOT EXISTS account_id text REFERENCES asset_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS simulation_incomes_start_date_idx ON simulation_incomes(start_date);
CREATE INDEX IF NOT EXISTS simulation_incomes_type_idx ON simulation_incomes(type);
CREATE INDEX IF NOT EXISTS simulation_incomes_account_id_idx ON simulation_incomes(account_id);

CREATE TABLE IF NOT EXISTS asset_transactions (
  id text PRIMARY KEY,
  asset_id text REFERENCES asset_items(id) ON DELETE SET NULL,
  position_key text,
  account_id text NOT NULL REFERENCES asset_accounts(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('buy', 'sell', 'dividend', 'maturity', 'deposit')),
  transaction_date date NOT NULL,
  quantity numeric,
  price numeric,
  amount numeric,
  currency text NOT NULL DEFAULT 'KRW',
  fx_rate_to_krw numeric NOT NULL DEFAULT 1,
  realized_gain_krw numeric NOT NULL DEFAULT 0,
  dividend_income_krw numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_transactions
  ADD COLUMN IF NOT EXISTS position_key text;

ALTER TABLE asset_transactions
  DROP CONSTRAINT IF EXISTS asset_transactions_transaction_type_check,
  ADD CONSTRAINT asset_transactions_transaction_type_check CHECK (transaction_type IN ('buy', 'sell', 'dividend', 'maturity', 'deposit'));

UPDATE asset_transactions t
SET position_key =
  CASE
    WHEN NULLIF(trim(a.ticker), '') IS NOT NULL
      THEN a.account_id || ':ticker:' || a.market || ':' || upper(trim(a.ticker))
    ELSE a.account_id || ':name:' || a.type || ':' || a.market || ':' || a.currency || ':' || lower(regexp_replace(trim(a.name), '[[:space:]]+', ' ', 'g'))
  END
FROM asset_items a
WHERE t.asset_id = a.id
  AND t.position_key IS NULL;

INSERT INTO asset_transactions (
  id,
  asset_id,
  position_key,
  account_id,
  transaction_type,
  transaction_date,
  quantity,
  price,
  amount,
  currency,
  fx_rate_to_krw,
  notes,
  created_at
)
SELECT
  'initial-buy-' || a.id,
  a.id,
  CASE
    WHEN NULLIF(trim(a.ticker), '') IS NOT NULL
      THEN a.account_id || ':ticker:' || a.market || ':' || upper(trim(a.ticker))
    ELSE a.account_id || ':name:' || a.type || ':' || a.market || ':' || a.currency || ':' || lower(regexp_replace(trim(a.name), '[[:space:]]+', ' ', 'g'))
  END,
  a.account_id,
  'buy',
  a.valuation_date,
  a.quantity,
  a.average_cost,
  COALESCE(a.quantity * a.average_cost, a.current_value, 0),
  a.currency,
  a.purchase_fx_rate_to_krw,
  '기존 자산 초기 매수 이력',
  a.created_at
FROM asset_items a
WHERE NOT EXISTS (
  SELECT 1
  FROM asset_transactions t
  WHERE t.id = 'initial-buy-' || a.id
);

CREATE INDEX IF NOT EXISTS asset_transactions_asset_id_idx ON asset_transactions(asset_id);
CREATE INDEX IF NOT EXISTS asset_transactions_account_id_idx ON asset_transactions(account_id);
CREATE INDEX IF NOT EXISTS asset_transactions_date_idx ON asset_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS asset_transactions_type_idx ON asset_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS asset_transactions_position_key_idx ON asset_transactions(position_key);

CREATE TABLE IF NOT EXISTS asset_transaction_lots (
  transaction_id text NOT NULL REFERENCES asset_transactions(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES asset_items(id) ON DELETE CASCADE,
  quantity numeric NOT NULL,
  realized_gain_krw numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (transaction_id, asset_id)
);

CREATE INDEX IF NOT EXISTS asset_transaction_lots_asset_id_idx ON asset_transaction_lots(asset_id);

CREATE TABLE IF NOT EXISTS asset_transaction_cash_links (
  transaction_id text NOT NULL REFERENCES asset_transactions(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES asset_items(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  PRIMARY KEY (transaction_id, asset_id)
);

CREATE INDEX IF NOT EXISTS asset_transaction_cash_links_asset_id_idx ON asset_transaction_cash_links(asset_id);

CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  snapshot_key text NOT NULL,
  target_date date NOT NULL,
  payload jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_key, target_date)
);

CREATE INDEX IF NOT EXISTS dashboard_snapshots_synced_at_idx ON dashboard_snapshots(synced_at DESC);
