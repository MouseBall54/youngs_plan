import "./env.js";
import pg from "pg";
import { randomUUID } from "node:crypto";
import type {
  Account,
  AssetMarket,
  AssetPriceHistory,
  AssetPosition,
  AssetQuantityHistory,
  AssetTransaction,
  AssetValuation,
  AssetWithAccount,
  FxRateHistory,
  HistoryPoint,
  PriceSource,
  SimulationAvailability,
  SimulationIncome,
  SimulationIncomeType,
  TransactionType
} from "./types.js";
import { estimateAssetCostKrw, estimateAssetValueKrw, valueAssetsForDate } from "./valuation.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const accountColumns = `
  id,
  name,
  institution,
  liquidity_restricted AS "liquidityRestricted",
  liquidity_unlock_date::text AS "liquidityUnlockDate",
  liquidity_restriction_reason AS "liquidityRestrictionReason",
  created_at AS "createdAt"
`;
const assetColumns = `
  a.id,
  a.account_id AS "accountId",
  a.type,
  a.name,
  a.market,
  a.ticker,
  a.currency,
  a.quantity::float AS "quantity",
  a.average_cost::float AS "averageCost",
  a.current_value::float AS "currentValue",
  a.valuation_date::text AS "valuationDate",
  a.purchase_fx_rate_to_krw::float AS "purchaseFxRateToKrw",
  a.fx_rate_to_krw::float AS "fxRateToKrw",
  a.price_source AS "priceSource",
  a.last_price_at AS "lastPriceAt",
  a.last_price_error AS "lastPriceError",
  a.liquid_from::text AS "liquidFrom",
  a.maturity_date::text AS "maturityDate",
  a.maturity_amount::float AS "maturityAmount",
  a.maturity_currency AS "maturityCurrency",
  a.maturity_fx_rate_to_krw::float AS "maturityFxRateToKrw",
  a.auto_convert_on_maturity AS "autoConvertOnMaturity",
  a.matured_at AS "maturedAt",
  a.notes,
  a.created_at AS "createdAt",
  ac.name AS "accountName",
  ac.institution,
  ac.liquidity_restricted AS "accountLiquidityRestricted",
  ac.liquidity_unlock_date::text AS "accountLiquidityUnlockDate",
  ac.liquidity_restriction_reason AS "accountLiquidityRestrictionReason"
`;
const transactionColumns = `
  t.id,
  t.asset_id AS "assetId",
  t.position_key AS "positionKey",
  t.account_id AS "accountId",
  ac.name AS "accountName",
  ac.institution,
  t.transaction_type AS "transactionType",
  t.transaction_date::text AS "transactionDate",
  t.quantity::float AS "quantity",
  t.price::float AS "price",
  t.amount::float AS "amount",
  t.currency,
  t.fx_rate_to_krw::float AS "fxRateToKrw",
  t.realized_gain_krw::float AS "realizedGainKrw",
  t.dividend_income_krw::float AS "dividendIncomeKrw",
  t.notes,
  t.created_at AS "createdAt",
  ai.name AS "assetName",
  ai.ticker
`;
const assetPriceHistoryColumns = `
  market,
  ticker,
  price_date::text AS "priceDate",
  close_price::float AS "closePrice",
  currency,
  source,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const fxRateHistoryColumns = `
  base_currency AS "baseCurrency",
  quote_currency AS "quoteCurrency",
  rate_date::text AS "rateDate",
  rate::float,
  source,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;
const simulationIncomeColumns = `
  si.id,
  si.account_id AS "accountId",
  ac.name AS "accountName",
  si.type,
  si.name,
  si.amount_krw::float AS "amountKrw",
  si.start_date::text AS "startDate",
  si.end_date::text AS "endDate",
  si.repeats_indefinitely AS "repeatsIndefinitely",
  si.availability,
  si.unlock_date::text AS "unlockDate",
  si.note,
  si.created_at AS "createdAt",
  si.updated_at AS "updatedAt"
`;

export async function listAccounts(): Promise<Account[]> {
  const result = await pool.query<Account>(`SELECT ${accountColumns} FROM asset_accounts ORDER BY created_at DESC`);
  return result.rows;
}

export async function createAccount(input: {
  name: string;
  institution?: string | null;
  liquidityRestricted?: boolean;
  liquidityUnlockDate?: string | null;
  liquidityRestrictionReason?: string | null;
}): Promise<Account> {
  const id = randomUUID();
  const result = await pool.query<Account>(
    `INSERT INTO asset_accounts (id, name, institution, liquidity_restricted, liquidity_unlock_date, liquidity_restriction_reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${accountColumns}`,
    [
      id,
      input.name,
      input.institution ?? null,
      input.liquidityRestricted ?? false,
      input.liquidityRestricted ? input.liquidityUnlockDate ?? null : null,
      input.liquidityRestricted ? input.liquidityRestrictionReason ?? null : null
    ]
  );
  return result.rows[0];
}

export async function updateAccount(
  id: string,
  input: {
    name: string;
    institution?: string | null;
    liquidityRestricted?: boolean;
    liquidityUnlockDate?: string | null;
    liquidityRestrictionReason?: string | null;
  }
): Promise<Account | null> {
  const result = await pool.query<Account>(
    `UPDATE asset_accounts
     SET name = $2,
         institution = $3,
         liquidity_restricted = $4,
         liquidity_unlock_date = $5,
         liquidity_restriction_reason = $6
     WHERE id = $1
     RETURNING ${accountColumns}`,
    [
      id,
      input.name,
      input.institution ?? null,
      input.liquidityRestricted ?? false,
      input.liquidityRestricted ? input.liquidityUnlockDate ?? null : null,
      input.liquidityRestricted ? input.liquidityRestrictionReason ?? null : null
    ]
  );
  return result.rows[0] ?? null;
}

export async function deleteAccount(id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM asset_accounts WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function listAssets(): Promise<AssetWithAccount[]> {
  const result = await pool.query<AssetWithAccount>(
    `SELECT ${assetColumns}
     FROM asset_items a
     JOIN asset_accounts ac ON ac.id = a.account_id
     WHERE (
       (a.quantity IS NOT NULL AND a.quantity > 0)
       OR (a.quantity IS NULL AND COALESCE(a.current_value, 0) > 0)
     )
     ORDER BY a.created_at DESC`
  );
  return result.rows;
}

export async function listAssetsForHistory(endDate: string): Promise<AssetWithAccount[]> {
  const result = await pool.query<AssetWithAccount>(
    `SELECT ${assetColumns}
     FROM asset_items a
     JOIN asset_accounts ac ON ac.id = a.account_id
     WHERE a.valuation_date <= $1
     ORDER BY a.valuation_date ASC, a.created_at ASC`,
    [endDate]
  );
  return result.rows;
}

export async function listPositions(targetDate: string): Promise<AssetPosition[]> {
  const assets = await listAssets();
  return aggregatePositions(valueAssetsForDate(assets, targetDate));
}

async function getAssetById(client: pg.Pool | pg.PoolClient, id: string): Promise<AssetWithAccount | null> {
  const result = await client.query<AssetWithAccount>(
    `SELECT ${assetColumns}
     FROM asset_items a
     JOIN asset_accounts ac ON ac.id = a.account_id
     WHERE a.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createAsset(input: {
  accountId: string;
  type: string;
  name: string;
  market: string;
  ticker?: string | null;
  currency: string;
  quantity?: number | null;
  averageCost?: number | null;
  currentValue?: number | null;
  valuationDate: string;
  purchaseFxRateToKrw?: number | null;
  fxRateToKrw?: number | null;
  liquidFrom: string;
  maturityDate?: string | null;
  maturityAmount?: number | null;
  maturityCurrency?: string | null;
  maturityFxRateToKrw?: number | null;
  autoConvertOnMaturity?: boolean | null;
  notes?: string | null;
}): Promise<AssetWithAccount> {
  const id = randomUUID();
  const result = await pool.query<AssetWithAccount>(
    `WITH inserted AS (
       INSERT INTO asset_items (
         id, account_id, type, name, market, ticker, currency, quantity, average_cost,
         current_value, valuation_date, purchase_fx_rate_to_krw, fx_rate_to_krw, liquid_from,
         maturity_date, maturity_amount, maturity_currency, maturity_fx_rate_to_krw, auto_convert_on_maturity, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING
         id,
         account_id AS "accountId",
         type,
         name,
         market,
         ticker,
         currency,
         quantity::float AS "quantity",
         average_cost::float AS "averageCost",
         current_value::float AS "currentValue",
         valuation_date::text AS "valuationDate",
         purchase_fx_rate_to_krw::float AS "purchaseFxRateToKrw",
         fx_rate_to_krw::float AS "fxRateToKrw",
         price_source AS "priceSource",
         last_price_at AS "lastPriceAt",
         last_price_error AS "lastPriceError",
         liquid_from::text AS "liquidFrom",
         maturity_date::text AS "maturityDate",
         maturity_amount::float AS "maturityAmount",
         maturity_currency AS "maturityCurrency",
         maturity_fx_rate_to_krw::float AS "maturityFxRateToKrw",
         auto_convert_on_maturity AS "autoConvertOnMaturity",
         matured_at AS "maturedAt",
         notes,
         created_at AS "createdAt"
     )
     SELECT
       i.*,
       ac.name AS "accountName",
       ac.institution,
       ac.liquidity_restricted AS "accountLiquidityRestricted",
       ac.liquidity_unlock_date::text AS "accountLiquidityUnlockDate",
       ac.liquidity_restriction_reason AS "accountLiquidityRestrictionReason"
     FROM inserted i
     JOIN asset_accounts ac ON ac.id = i."accountId"`,
    [
      id,
      input.accountId,
      input.type,
      input.name,
      input.market,
      input.ticker?.trim() || null,
      input.currency,
      input.quantity ?? null,
      input.averageCost ?? null,
      input.currentValue ?? null,
      input.valuationDate,
      input.purchaseFxRateToKrw ?? input.fxRateToKrw ?? 1,
      input.fxRateToKrw ?? 1,
      input.liquidFrom,
      input.type === "bond" ? input.maturityDate ?? null : null,
      input.type === "bond" ? input.maturityAmount ?? null : null,
      input.type === "bond" ? input.maturityCurrency?.trim().toUpperCase() || input.currency : null,
      input.type === "bond" ? input.maturityFxRateToKrw ?? input.fxRateToKrw ?? 1 : null,
      input.type === "bond" ? input.autoConvertOnMaturity ?? true : true,
      input.notes ?? null
    ]
  );
  await saveAssetSnapshot(result.rows[0]);
  return result.rows[0];
}

async function createAssetWithClient(
  client: pg.PoolClient,
  input: Parameters<typeof createAsset>[0]
): Promise<AssetWithAccount> {
  const id = randomUUID();
  const result = await client.query<AssetWithAccount>(
    `WITH inserted AS (
       INSERT INTO asset_items (
         id, account_id, type, name, market, ticker, currency, quantity, average_cost,
         current_value, valuation_date, purchase_fx_rate_to_krw, fx_rate_to_krw, liquid_from,
         maturity_date, maturity_amount, maturity_currency, maturity_fx_rate_to_krw, auto_convert_on_maturity, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING
         id,
         account_id AS "accountId",
         type,
         name,
         market,
         ticker,
         currency,
         quantity::float AS "quantity",
         average_cost::float AS "averageCost",
         current_value::float AS "currentValue",
         valuation_date::text AS "valuationDate",
         purchase_fx_rate_to_krw::float AS "purchaseFxRateToKrw",
         fx_rate_to_krw::float AS "fxRateToKrw",
         price_source AS "priceSource",
         last_price_at AS "lastPriceAt",
         last_price_error AS "lastPriceError",
         liquid_from::text AS "liquidFrom",
         maturity_date::text AS "maturityDate",
         maturity_amount::float AS "maturityAmount",
         maturity_currency AS "maturityCurrency",
         maturity_fx_rate_to_krw::float AS "maturityFxRateToKrw",
         auto_convert_on_maturity AS "autoConvertOnMaturity",
         matured_at AS "maturedAt",
         notes,
         created_at AS "createdAt"
     )
     SELECT
       i.*,
       ac.name AS "accountName",
       ac.institution,
       ac.liquidity_restricted AS "accountLiquidityRestricted",
       ac.liquidity_unlock_date::text AS "accountLiquidityUnlockDate",
       ac.liquidity_restriction_reason AS "accountLiquidityRestrictionReason"
     FROM inserted i
     JOIN asset_accounts ac ON ac.id = i."accountId"`,
    [
      id,
      input.accountId,
      input.type,
      input.name,
      input.market,
      input.ticker?.trim() || null,
      input.currency,
      input.quantity ?? null,
      input.averageCost ?? null,
      input.currentValue ?? null,
      input.valuationDate,
      input.purchaseFxRateToKrw ?? input.fxRateToKrw ?? 1,
      input.fxRateToKrw ?? 1,
      input.liquidFrom,
      input.type === "bond" ? input.maturityDate ?? null : null,
      input.type === "bond" ? input.maturityAmount ?? null : null,
      input.type === "bond" ? input.maturityCurrency?.trim().toUpperCase() || input.currency : null,
      input.type === "bond" ? input.maturityFxRateToKrw ?? input.fxRateToKrw ?? 1 : null,
      input.type === "bond" ? input.autoConvertOnMaturity ?? true : true,
      input.notes ?? null
    ]
  );
  await saveAssetSnapshotWithClient(client, result.rows[0]);
  return result.rows[0];
}

export async function updateAsset(input: {
  id: string;
  accountId: string;
  type: string;
  name: string;
  market: string;
  ticker?: string | null;
  currency: string;
  quantity?: number | null;
  averageCost?: number | null;
  currentValue?: number | null;
  valuationDate: string;
  purchaseFxRateToKrw?: number | null;
  fxRateToKrw?: number | null;
  liquidFrom: string;
  maturityDate?: string | null;
  maturityAmount?: number | null;
  maturityCurrency?: string | null;
  maturityFxRateToKrw?: number | null;
  autoConvertOnMaturity?: boolean | null;
  notes?: string | null;
}): Promise<AssetWithAccount | null> {
  const result = await pool.query<AssetWithAccount>(
    `WITH updated AS (
       UPDATE asset_items
       SET account_id = $2,
           type = $3,
           name = $4,
           market = $5,
           ticker = $6,
           currency = $7,
           quantity = $8,
           average_cost = $9,
           current_value = $10,
           valuation_date = $11,
           purchase_fx_rate_to_krw = $12,
           fx_rate_to_krw = $13,
           liquid_from = $14,
           maturity_date = $15,
           maturity_amount = $16,
           maturity_currency = $17,
           maturity_fx_rate_to_krw = $18,
           auto_convert_on_maturity = $19,
           notes = $20,
           price_source = 'manual',
           last_price_error = NULL
       WHERE id = $1
       RETURNING
         id,
         account_id AS "accountId",
         type,
         name,
         market,
         ticker,
         currency,
         quantity::float AS "quantity",
         average_cost::float AS "averageCost",
         current_value::float AS "currentValue",
         valuation_date::text AS "valuationDate",
         purchase_fx_rate_to_krw::float AS "purchaseFxRateToKrw",
         fx_rate_to_krw::float AS "fxRateToKrw",
         price_source AS "priceSource",
         last_price_at AS "lastPriceAt",
         last_price_error AS "lastPriceError",
         liquid_from::text AS "liquidFrom",
         maturity_date::text AS "maturityDate",
         maturity_amount::float AS "maturityAmount",
         maturity_currency AS "maturityCurrency",
         maturity_fx_rate_to_krw::float AS "maturityFxRateToKrw",
         auto_convert_on_maturity AS "autoConvertOnMaturity",
         matured_at AS "maturedAt",
         notes,
         created_at AS "createdAt"
     )
     SELECT
       u.*,
       ac.name AS "accountName",
       ac.institution,
       ac.liquidity_restricted AS "accountLiquidityRestricted",
       ac.liquidity_unlock_date::text AS "accountLiquidityUnlockDate",
       ac.liquidity_restriction_reason AS "accountLiquidityRestrictionReason"
     FROM updated u
     JOIN asset_accounts ac ON ac.id = u."accountId"`,
    [
      input.id,
      input.accountId,
      input.type,
      input.name,
      input.market,
      input.ticker?.trim() || null,
      input.currency,
      input.quantity ?? null,
      input.averageCost ?? null,
      input.currentValue ?? null,
      input.valuationDate,
      input.purchaseFxRateToKrw ?? input.fxRateToKrw ?? 1,
      input.fxRateToKrw ?? 1,
      input.liquidFrom,
      input.type === "bond" ? input.maturityDate ?? null : null,
      input.type === "bond" ? input.maturityAmount ?? null : null,
      input.type === "bond" ? input.maturityCurrency?.trim().toUpperCase() || input.currency : null,
      input.type === "bond" ? input.maturityFxRateToKrw ?? input.fxRateToKrw ?? 1 : null,
      input.type === "bond" ? input.autoConvertOnMaturity ?? true : true,
      input.notes ?? null
    ]
  );
  const asset = result.rows[0] ?? null;
  if (asset) {
    await saveAssetSnapshot(asset);
  }
  return asset;
}

export async function deleteAsset(id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM asset_items WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function listTickerAssets(): Promise<AssetWithAccount[]> {
  const result = await pool.query<AssetWithAccount>(
    `SELECT ${assetColumns}
     FROM asset_items a
     JOIN asset_accounts ac ON ac.id = a.account_id
     WHERE NULLIF(trim(a.ticker), '') IS NOT NULL
       AND (
         (a.quantity IS NOT NULL AND a.quantity > 0)
         OR (a.quantity IS NULL AND COALESCE(a.current_value, 0) > 0)
       )
     ORDER BY a.created_at DESC`
  );
  return result.rows;
}

export async function listTickerAssetsForHistory(): Promise<AssetWithAccount[]> {
  const result = await pool.query<AssetWithAccount>(
    `SELECT ${assetColumns}
     FROM asset_items a
     JOIN asset_accounts ac ON ac.id = a.account_id
     WHERE NULLIF(trim(a.ticker), '') IS NOT NULL
     ORDER BY a.market ASC, upper(trim(a.ticker)) ASC, a.created_at ASC`
  );
  return result.rows;
}

export async function listAssetQuantityHistory(assetIds: string[]): Promise<AssetQuantityHistory[]> {
  if (assetIds.length === 0) {
    return [];
  }

  const initialResult = await pool.query<AssetQuantityHistory>(
    `SELECT
       a.id AS "assetId",
       a.valuation_date::text AS "date",
       COALESCE(t.quantity, a.quantity)::float AS "quantity"
     FROM asset_items a
     LEFT JOIN asset_transactions t ON t.asset_id = a.id AND t.transaction_type = 'buy'
     WHERE a.id = ANY($1::text[])
       AND COALESCE(t.quantity, a.quantity) IS NOT NULL`,
    [assetIds]
  );
  const deductionResult = await pool.query<{
    assetId: string;
    date: string;
    quantity: number;
  }>(
    `SELECT
       l.asset_id AS "assetId",
       t.transaction_date::text AS "date",
       COALESCE(SUM(l.quantity), 0)::float AS "quantity"
     FROM asset_transaction_lots l
     JOIN asset_transactions t ON t.id = l.transaction_id
     WHERE l.asset_id = ANY($1::text[])
       AND t.transaction_type IN ('sell', 'maturity')
     GROUP BY l.asset_id, t.transaction_date
     ORDER BY t.transaction_date ASC`,
    [assetIds]
  );
  const events = new Map<string, AssetQuantityHistory[]>();

  for (const initial of initialResult.rows) {
    events.set(initial.assetId, [{ ...initial }]);
  }

  for (const deduction of deductionResult.rows) {
    const assetEvents = events.get(deduction.assetId);
    if (!assetEvents?.length) continue;

    const previousQuantity = assetEvents.at(-1)?.quantity ?? 0;
    assetEvents.push({
      assetId: deduction.assetId,
      date: deduction.date,
      quantity: Math.max(0, previousQuantity - deduction.quantity)
    });
  }

  return [...events.values()].flat().sort((a, b) => a.date.localeCompare(b.date));
}

export async function upsertAssetPriceHistory(input: {
  market: AssetMarket;
  ticker: string;
  priceDate: string;
  closePrice: number;
  currency: string;
  source?: PriceSource;
}): Promise<AssetPriceHistory> {
  const result = await pool.query<AssetPriceHistory>(
    `INSERT INTO asset_price_history (market, ticker, price_date, close_price, currency, source)
     VALUES ($1, upper(trim($2)), $3, $4, upper(trim($5)), $6)
     ON CONFLICT (market, ticker, price_date)
     DO UPDATE SET
       close_price = EXCLUDED.close_price,
       currency = EXCLUDED.currency,
       source = EXCLUDED.source,
       updated_at = now()
     RETURNING ${assetPriceHistoryColumns}`,
    [input.market, input.ticker, input.priceDate, input.closePrice, input.currency, input.source ?? "manual"]
  );
  return result.rows[0];
}

export async function listAssetPriceHistory(
  startDate: string,
  endDate: string,
  tickers?: Array<{ market: AssetMarket; ticker: string }>
): Promise<AssetPriceHistory[]> {
  const tickerKeys = tickers?.map((item) => `${item.market}:${item.ticker.trim().toUpperCase()}`) ?? null;
  const result = await pool.query<AssetPriceHistory>(
    `SELECT ${assetPriceHistoryColumns}
     FROM asset_price_history
     WHERE price_date BETWEEN $1 AND $2
       AND ($3::text[] IS NULL OR market || ':' || upper(trim(ticker)) = ANY($3::text[]))
     ORDER BY price_date ASC, market ASC, ticker ASC`,
    [startDate, endDate, tickerKeys]
  );
  return result.rows;
}

export async function upsertFxRateHistory(input: {
  baseCurrency: string;
  quoteCurrency: string;
  rateDate: string;
  rate: number;
  source?: PriceSource;
}): Promise<FxRateHistory> {
  const result = await pool.query<FxRateHistory>(
    `INSERT INTO fx_rate_history (base_currency, quote_currency, rate_date, rate, source)
     VALUES (upper(trim($1)), upper(trim($2)), $3, $4, $5)
     ON CONFLICT (base_currency, quote_currency, rate_date)
     DO UPDATE SET
       rate = EXCLUDED.rate,
       source = EXCLUDED.source,
       updated_at = now()
     RETURNING ${fxRateHistoryColumns}`,
    [input.baseCurrency, input.quoteCurrency, input.rateDate, input.rate, input.source ?? "manual"]
  );
  return result.rows[0];
}

export async function listFxRateHistory(
  baseCurrency: string,
  quoteCurrency: string,
  startDate: string,
  endDate: string
): Promise<FxRateHistory[]> {
  const result = await pool.query<FxRateHistory>(
    `SELECT ${fxRateHistoryColumns}
     FROM fx_rate_history
     WHERE base_currency = upper(trim($1))
       AND quote_currency = upper(trim($2))
       AND rate_date BETWEEN $3 AND $4
     ORDER BY rate_date ASC`,
    [baseCurrency, quoteCurrency, startDate, endDate]
  );
  return result.rows;
}

export async function listSimulationIncomes(): Promise<SimulationIncome[]> {
  const result = await pool.query<SimulationIncome>(
    `SELECT ${simulationIncomeColumns}
     FROM simulation_incomes si
     LEFT JOIN asset_accounts ac ON ac.id = si.account_id
     ORDER BY si.start_date ASC, si.created_at ASC`
  );
  return result.rows;
}

export async function createSimulationIncome(input: {
  accountId?: string | null;
  type: SimulationIncomeType;
  name: string;
  amountKrw: number;
  startDate: string;
  endDate?: string | null;
  repeatsIndefinitely: boolean;
  availability: SimulationAvailability;
  unlockDate?: string | null;
  note?: string | null;
}): Promise<SimulationIncome> {
  const id = randomUUID();
  const result = await pool.query<SimulationIncome>(
    `WITH inserted AS (
       INSERT INTO simulation_incomes (
         id, account_id, type, name, amount_krw, start_date, end_date, repeats_indefinitely, availability, unlock_date, note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *
     )
     SELECT ${simulationIncomeColumns}
     FROM inserted si
     LEFT JOIN asset_accounts ac ON ac.id = si.account_id`,
    [
      id,
      input.accountId ?? null,
      input.type,
      input.name,
      input.amountKrw,
      input.startDate,
      input.type === "monthly" && !input.repeatsIndefinitely ? input.endDate ?? null : null,
      input.type === "monthly" ? input.repeatsIndefinitely : false,
      input.availability,
      input.availability === "unlock_date" ? input.unlockDate ?? null : null,
      input.note ?? ""
    ]
  );
  return result.rows[0];
}

export async function updateSimulationIncome(
  id: string,
  input: {
    accountId?: string | null;
    type: SimulationIncomeType;
    name: string;
    amountKrw: number;
    startDate: string;
    endDate?: string | null;
    repeatsIndefinitely: boolean;
    availability: SimulationAvailability;
    unlockDate?: string | null;
    note?: string | null;
  }
): Promise<SimulationIncome | null> {
  const result = await pool.query<SimulationIncome>(
    `WITH updated AS (
       UPDATE simulation_incomes
       SET account_id = $2,
           type = $3,
           name = $4,
           amount_krw = $5,
           start_date = $6,
           end_date = $7,
           repeats_indefinitely = $8,
           availability = $9,
           unlock_date = $10,
           note = $11,
           updated_at = now()
       WHERE id = $1
       RETURNING *
     )
     SELECT ${simulationIncomeColumns}
     FROM updated si
     LEFT JOIN asset_accounts ac ON ac.id = si.account_id`,
    [
      id,
      input.accountId ?? null,
      input.type,
      input.name,
      input.amountKrw,
      input.startDate,
      input.type === "monthly" && !input.repeatsIndefinitely ? input.endDate ?? null : null,
      input.type === "monthly" ? input.repeatsIndefinitely : false,
      input.availability,
      input.availability === "unlock_date" ? input.unlockDate ?? null : null,
      input.note ?? ""
    ]
  );
  return result.rows[0] ?? null;
}

export async function deleteSimulationIncome(id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM simulation_incomes WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function updateAssetPrice(input: {
  id: string;
  currentValue: number;
  purchaseFxRateToKrw?: number;
  fxRateToKrw?: number;
  source: Exclude<PriceSource, "manual">;
}): Promise<AssetWithAccount | null> {
  const result = await pool.query<AssetWithAccount>(
    `WITH updated AS (
       UPDATE asset_items
       SET current_value = $2,
           purchase_fx_rate_to_krw = COALESCE($3, purchase_fx_rate_to_krw),
           fx_rate_to_krw = COALESCE($4, fx_rate_to_krw),
           price_source = $5,
           last_price_at = now(),
           last_price_error = NULL
       WHERE id = $1
       RETURNING
         id,
         account_id AS "accountId",
         type,
         name,
         market,
         ticker,
         currency,
         quantity::float AS "quantity",
         average_cost::float AS "averageCost",
         current_value::float AS "currentValue",
         valuation_date::text AS "valuationDate",
         purchase_fx_rate_to_krw::float AS "purchaseFxRateToKrw",
         fx_rate_to_krw::float AS "fxRateToKrw",
         price_source AS "priceSource",
         last_price_at AS "lastPriceAt",
         last_price_error AS "lastPriceError",
         liquid_from::text AS "liquidFrom",
         maturity_date::text AS "maturityDate",
         maturity_amount::float AS "maturityAmount",
         maturity_currency AS "maturityCurrency",
         maturity_fx_rate_to_krw::float AS "maturityFxRateToKrw",
         auto_convert_on_maturity AS "autoConvertOnMaturity",
         matured_at AS "maturedAt",
         notes,
         created_at AS "createdAt"
     )
     SELECT
       u.*,
       ac.name AS "accountName",
       ac.institution,
       ac.liquidity_restricted AS "accountLiquidityRestricted",
       ac.liquidity_unlock_date::text AS "accountLiquidityUnlockDate",
       ac.liquidity_restriction_reason AS "accountLiquidityRestrictionReason"
     FROM updated u
     JOIN asset_accounts ac ON ac.id = u."accountId"`,
    [input.id, input.currentValue, input.purchaseFxRateToKrw ?? null, input.fxRateToKrw ?? null, input.source]
  );
  const asset = result.rows[0] ?? null;
  if (asset) {
    await saveAssetSnapshot(asset);
  }
  return asset;
}

export async function markAssetPriceError(id: string, message: string): Promise<void> {
  await pool.query("UPDATE asset_items SET last_price_error = $2 WHERE id = $1", [id, message]);
}

export async function saveAssetSnapshot(asset: AssetWithAccount): Promise<void> {
  await saveAssetSnapshotWithClient(pool, asset);
}

async function saveAssetSnapshotWithClient(client: pg.Pool | pg.PoolClient, asset: AssetWithAccount): Promise<void> {
  await client.query(
    `INSERT INTO asset_value_history (
       asset_id, valuation_date, current_value, value_krw, cost_krw, purchase_fx_rate_to_krw, fx_rate_to_krw
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (asset_id, valuation_date)
     DO UPDATE SET
       current_value = EXCLUDED.current_value,
       value_krw = EXCLUDED.value_krw,
       cost_krw = EXCLUDED.cost_krw,
       purchase_fx_rate_to_krw = EXCLUDED.purchase_fx_rate_to_krw,
       fx_rate_to_krw = EXCLUDED.fx_rate_to_krw,
       updated_at = now()`,
    [
      asset.id,
      asset.valuationDate,
      asset.currentValue,
      estimateAssetValueKrw(asset),
      estimateAssetCostKrw(asset),
      asset.purchaseFxRateToKrw,
      asset.fxRateToKrw
    ]
  );
}

export async function listTransactions(): Promise<AssetTransaction[]> {
  const result = await pool.query<AssetTransaction>(
    `SELECT ${transactionColumns}
     FROM asset_transactions t
     JOIN asset_accounts ac ON ac.id = t.account_id
     LEFT JOIN asset_items ai ON ai.id = t.asset_id
     ORDER BY t.transaction_date DESC, t.created_at DESC`
  );
  return result.rows;
}

export async function transactionTotalsUntil(targetDate: string): Promise<{
  realizedGainKrw: number;
  dividendIncomeKrw: number;
}> {
  const result = await pool.query<{ realizedGainKrw: number; dividendIncomeKrw: number }>(
    `SELECT
       COALESCE(SUM(realized_gain_krw), 0)::float AS "realizedGainKrw",
       COALESCE(SUM(dividend_income_krw), 0)::float AS "dividendIncomeKrw"
     FROM asset_transactions
     WHERE transaction_date <= $1`,
    [targetDate]
  );
  return result.rows[0] ?? { realizedGainKrw: 0, dividendIncomeKrw: 0 };
}

export async function transactionTotalsByDate(startDate: string, endDate: string): Promise<
  Array<{ date: string; realizedGainKrw: number; dividendIncomeKrw: number }>
> {
  const result = await pool.query<{ date: string; realizedGainKrw: number; dividendIncomeKrw: number }>(
    `SELECT
       transaction_date::text AS "date",
       COALESCE(SUM(realized_gain_krw), 0)::float AS "realizedGainKrw",
       COALESCE(SUM(dividend_income_krw), 0)::float AS "dividendIncomeKrw"
     FROM asset_transactions
     WHERE transaction_date BETWEEN $1 AND $2
     GROUP BY transaction_date
     ORDER BY transaction_date ASC`,
    [startDate, endDate]
  );
  return result.rows;
}

export async function createTransaction(input: {
  assetId?: string | null;
  positionKey?: string | null;
  accountId?: string | null;
  transactionType: TransactionType;
  transactionDate: string;
  type?: string;
  name?: string;
  market?: string;
  ticker?: string | null;
  liquidFrom?: string;
  quantity?: number | null;
  price?: number | null;
  amount?: number | null;
  currentValue?: number | null;
  currency: string;
  purchaseFxRateToKrw?: number | null;
  fxRateToKrw?: number | null;
  maturityDate?: string | null;
  maturityAmount?: number | null;
  maturityCurrency?: string | null;
  maturityFxRateToKrw?: number | null;
  autoConvertOnMaturity?: boolean | null;
  notes?: string | null;
}): Promise<AssetTransaction> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transaction = await createTransactionWithClient(client, input);
    await client.query("COMMIT");
    return transaction;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createTransactionWithClient(
  client: pg.PoolClient,
  input: Parameters<typeof createTransaction>[0]
): Promise<AssetTransaction> {
  let transaction: AssetTransaction;

  if (input.transactionType === "buy") {
    if (!input.accountId || !input.type || !input.name || !input.market) {
      throw new Error("매수 거래에는 계좌, 자산 분류, 자산명, 시장 정보가 필요합니다.");
    }

    const asset = await createAssetWithClient(client, {
      accountId: input.accountId,
      type: input.type,
      name: input.name,
      market: input.market,
      ticker: input.ticker,
      currency: input.currency,
      quantity: input.quantity ?? null,
      averageCost: input.price ?? null,
      currentValue: input.currentValue ?? input.price ?? input.amount ?? null,
      valuationDate: input.transactionDate,
      purchaseFxRateToKrw: input.purchaseFxRateToKrw ?? input.fxRateToKrw ?? 1,
      fxRateToKrw: input.fxRateToKrw ?? 1,
      liquidFrom: input.liquidFrom ?? input.transactionDate,
      maturityDate: input.maturityDate ?? null,
      maturityAmount: input.maturityAmount ?? null,
      maturityCurrency: input.maturityCurrency ?? input.currency,
      maturityFxRateToKrw: input.maturityFxRateToKrw ?? input.fxRateToKrw ?? 1,
      autoConvertOnMaturity: input.autoConvertOnMaturity ?? true,
      notes: input.notes ?? null
    });
    transaction = await insertTransaction(client, {
      assetId: asset.id,
      positionKey: assetPositionKey(asset),
      accountId: asset.accountId,
      transactionType: "buy",
      transactionDate: input.transactionDate,
      quantity: input.quantity ?? null,
      price: input.price ?? null,
      amount: input.amount ?? estimateNativeAmount(input.quantity ?? null, input.price ?? input.amount ?? null),
      currency: input.currency,
      fxRateToKrw: input.purchaseFxRateToKrw ?? input.fxRateToKrw ?? 1,
      realizedGainKrw: 0,
      dividendIncomeKrw: 0,
      notes: input.notes ?? null
    });
  } else {
    if (!input.assetId && !input.positionKey) {
      throw new Error("매도/배당 거래에는 보유 자산 선택이 필요합니다.");
    }

    const lots = await resolveTransactionLots(client, {
      assetId: input.assetId ?? null,
      positionKey: input.positionKey ?? null
    });
    if (lots.length === 0) throw new Error("선택한 보유 자산을 찾을 수 없습니다.");
    const position = aggregatePositions(valueAssetsForDate(lots, input.transactionDate))[0];
    if (!position) throw new Error("선택한 통합 포지션을 계산하지 못했습니다.");
    const representativeAsset = lots[0];

    if (input.transactionType === "sell") {
      const sellQuantity = input.quantity ?? 0;
      const sellPrice = input.price ?? 0;
      const fxRate = input.fxRateToKrw ?? position.fxRateToKrw;
      if (sellQuantity <= 0 || sellPrice <= 0) {
        throw new Error("매도 수량과 매도 단가는 0보다 커야 합니다.");
      }
      const totalQuantity = position.quantity ?? 0;
      if (sellQuantity > totalQuantity) {
        throw new Error("보유 수량보다 많이 매도할 수 없습니다.");
      }

      const lotDeductions = await applyFifoSellLots(client, lots, sellQuantity, sellPrice, input.transactionDate, fxRate);
      const realizedGainKrw = lotDeductions.reduce((sum, lot) => sum + lot.realizedGainKrw, 0);
      transaction = await insertTransaction(client, {
        assetId: representativeAsset.id,
        positionKey: position.positionKey,
        accountId: representativeAsset.accountId,
        transactionType: "sell",
        transactionDate: input.transactionDate,
        quantity: sellQuantity,
        price: sellPrice,
        amount: sellQuantity * sellPrice,
        currency: input.currency || representativeAsset.currency,
        fxRateToKrw: fxRate,
        realizedGainKrw,
        dividendIncomeKrw: 0,
        notes: input.notes ?? null
      });
      await insertTransactionLots(client, transaction.id, lotDeductions);
    } else {
      const amount = input.amount ?? 0;
      const fxRate = input.fxRateToKrw ?? position.fxRateToKrw;
      if (amount <= 0) {
        throw new Error("배당금은 0보다 커야 합니다.");
      }
      transaction = await insertTransaction(client, {
        assetId: representativeAsset.id,
        positionKey: position.positionKey,
        accountId: representativeAsset.accountId,
        transactionType: "dividend",
        transactionDate: input.transactionDate,
        quantity: null,
        price: null,
        amount,
        currency: input.currency || representativeAsset.currency,
        fxRateToKrw: fxRate,
        realizedGainKrw: 0,
        dividendIncomeKrw: Math.round(amount * fxRate),
        notes: input.notes ?? null
      });
    }
  }

  return transaction;
}

export async function deleteTransaction(id: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deleted = await deleteTransactionWithClient(client, id);
    await client.query("COMMIT");
    return deleted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteTransactionWithClient(client: pg.PoolClient, id: string): Promise<boolean> {
  const transactionResult = await client.query<{
    id: string;
    assetId: string | null;
    positionKey: string | null;
    transactionType: TransactionType;
    transactionDate: string;
    quantity: number | null;
    amount: number | null;
    fxRateToKrw: number;
  }>(
    `SELECT
         id,
         asset_id AS "assetId",
         position_key AS "positionKey",
         transaction_type AS "transactionType",
         transaction_date::text AS "transactionDate",
         quantity::float AS "quantity",
         amount::float AS "amount",
         fx_rate_to_krw::float AS "fxRateToKrw"
       FROM asset_transactions
       WHERE id = $1
       FOR UPDATE`,
    [id]
  );
  const transaction = transactionResult.rows[0];
  if (!transaction) {
    return false;
  }

  if (transaction.transactionType === "deposit") {
    const result = await client.query("DELETE FROM asset_transactions WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  if (isZeroQuantityTransaction(transaction)) {
    return deleteZeroQuantityTransactionWithClient(client, transaction);
  }

  if (transaction.transactionType === "sell" || transaction.transactionType === "maturity") {
    const lotResult = await client.query<{ assetId: string; quantity: number }>(
      `SELECT asset_id AS "assetId", quantity::float AS "quantity"
         FROM asset_transaction_lots
         WHERE transaction_id = $1`,
      [transaction.id]
    );

    if (lotResult.rows.length > 0) {
      for (const lot of lotResult.rows) {
        const asset = await getAssetById(client, lot.assetId);
        if (!asset) continue;
        const restoredQuantity = (asset.quantity ?? 0) + lot.quantity;
        const updatedAsset = await updateAssetQuantityWithClient(
          client,
          asset.id,
          restoredQuantity,
          transaction.transactionDate,
          transaction.fxRateToKrw
        );
        if (updatedAsset) await saveAssetSnapshotWithClient(client, updatedAsset);
        if (transaction.transactionType === "maturity") {
          await client.query("UPDATE asset_items SET matured_at = NULL, auto_convert_on_maturity = false WHERE id = $1", [asset.id]);
        }
      }
    } else {
      if (!transaction.assetId) {
        throw new Error("매도 거래에 연결된 자산을 찾을 수 없습니다.");
      }
      const asset = await getAssetById(client, transaction.assetId);
      if (!asset) {
        throw new Error("매도 거래의 보유 자산을 찾을 수 없습니다.");
      }
      const restoredQuantity = (asset.quantity ?? 0) + (transaction.quantity ?? 0);
      const updatedAsset = await updateAssetQuantityWithClient(
        client,
        asset.id,
        restoredQuantity,
        transaction.transactionDate,
        transaction.fxRateToKrw
      );
      if (updatedAsset) {
        await saveAssetSnapshotWithClient(client, updatedAsset);
      }
      if (transaction.transactionType === "maturity") {
        await client.query("UPDATE asset_items SET matured_at = NULL, auto_convert_on_maturity = false WHERE id = $1", [asset.id]);
      }
    }
  }

  if (transaction.transactionType === "maturity") {
    const cashLinks = await client.query<{ assetId: string; amount: number }>(
      `SELECT asset_id AS "assetId", amount::float AS "amount"
       FROM asset_transaction_cash_links
       WHERE transaction_id = $1`,
      [transaction.id]
    );
    for (const link of cashLinks.rows) {
      await reduceCashMaturityValueWithClient(client, link.assetId, link.amount, transaction.transactionDate);
    }
  }

  if (transaction.transactionType === "buy" && transaction.assetId) {
    const dependentResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM asset_transactions
       WHERE id <> $2
         AND transaction_type IN ('sell', 'dividend', 'maturity')
         AND (
           asset_id = $1
           OR ($3::text IS NOT NULL AND position_key = $3)
           OR EXISTS (
             SELECT 1
             FROM asset_transaction_lots l
             WHERE l.transaction_id = asset_transactions.id
               AND l.asset_id = $1
           )
         )`,
      [transaction.assetId, transaction.id, transaction.positionKey]
    );
    if (Number(dependentResult.rows[0]?.count ?? 0) > 0) {
      throw new Error("매도/배당 이력이 있는 매수 거래는 먼저 후속 거래를 삭제해야 합니다.");
    }
  }

  const result = await client.query("DELETE FROM asset_transactions WHERE id = $1", [id]);
  if (transaction.transactionType === "buy" && transaction.assetId) {
    await client.query("DELETE FROM asset_items WHERE id = $1", [transaction.assetId]);
  }

  return (result.rowCount ?? 0) > 0;
}

function isZeroQuantityTransaction(transaction: { transactionType: TransactionType; quantity: number | null }): boolean {
  return (transaction.transactionType === "buy" || transaction.transactionType === "sell") && transaction.quantity === 0;
}

async function deleteZeroQuantityTransactionWithClient(
  client: pg.PoolClient,
  transaction: { id: string; assetId: string | null; positionKey: string | null; transactionType: TransactionType }
): Promise<boolean> {
  const result = await client.query("DELETE FROM asset_transactions WHERE id = $1", [transaction.id]);

  if (transaction.transactionType === "buy" && transaction.assetId) {
    const assetResult = await client.query<{ quantity: number | null }>(
      `SELECT quantity::float AS quantity
       FROM asset_items
       WHERE id = $1`,
      [transaction.assetId]
    );
    const assetQuantity = assetResult.rows[0]?.quantity ?? null;
    const dependentResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM asset_transactions
       WHERE id <> $2
         AND (
           asset_id = $1
           OR ($3::text IS NOT NULL AND position_key = $3)
           OR EXISTS (
             SELECT 1
             FROM asset_transaction_lots l
             WHERE l.transaction_id = asset_transactions.id
               AND l.asset_id = $1
           )
         )`,
      [transaction.assetId, transaction.id, transaction.positionKey]
    );

    if ((assetQuantity ?? 0) === 0 && Number(dependentResult.rows[0]?.count ?? 0) === 0) {
      await client.query("DELETE FROM asset_items WHERE id = $1", [transaction.assetId]);
    }
  }

  return (result.rowCount ?? 0) > 0;
}

export async function updateTransaction(
  id: string,
  input: Parameters<typeof createTransaction>[0]
): Promise<AssetTransaction | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deleted = await deleteTransactionWithClient(client, id);
    if (!deleted) {
      await client.query("ROLLBACK");
      return null;
    }
    const transaction = await createTransactionWithClient(client, input);
    await client.query("COMMIT");
    return transaction;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processMaturedBonds(targetDate: string): Promise<AssetTransaction[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const bonds = await listMaturedBondLotsForUpdate(client, targetDate);
    const transactions: AssetTransaction[] = [];

    for (const bond of bonds) {
      const maturityAmount = bond.maturityAmount ?? 0;
      if (maturityAmount <= 0 || !bond.maturityDate) continue;

      const quantity = bond.quantity ?? 1;
      const maturityCurrency = (bond.maturityCurrency ?? bond.currency).toUpperCase();
      const maturityFxRate = bond.maturityFxRateToKrw ?? bond.fxRateToKrw ?? 1;
      const proceedsKrw = Math.round(maturityAmount * maturityFxRate);
      const costKrw = estimateAssetCostKrw(bond);
      const realizedGainKrw = Math.round(proceedsKrw - costKrw);

      const updatedBond = await updateAssetQuantityWithClient(client, bond.id, 0, bond.maturityDate, maturityFxRate);
      await client.query("UPDATE asset_items SET matured_at = now() WHERE id = $1", [bond.id]);
      if (updatedBond) await saveAssetSnapshotWithClient(client, updatedBond);

      const cashAsset = await addMaturityCashWithClient(client, bond, maturityAmount, maturityCurrency, maturityFxRate);
      const transaction = await insertTransaction(client, {
        assetId: bond.id,
        positionKey: assetPositionKey(bond),
        accountId: bond.accountId,
        transactionType: "maturity",
        transactionDate: bond.maturityDate,
        quantity,
        price: null,
        amount: maturityAmount,
        currency: maturityCurrency,
        fxRateToKrw: maturityFxRate,
        realizedGainKrw,
        dividendIncomeKrw: 0,
        notes: `${bond.name} 만기 상환`
      });
      await insertTransactionLots(client, transaction.id, [{ assetId: bond.id, quantity, realizedGainKrw }]);
      await insertCashLink(client, transaction.id, cashAsset.id, maturityAmount);
      transactions.push(transaction);
    }

    await client.query("COMMIT");
    return transactions;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertTransaction(
  client: pg.PoolClient,
  input: {
    assetId: string | null;
    positionKey?: string | null;
    accountId: string;
    transactionType: TransactionType;
    transactionDate: string;
    quantity: number | null;
    price: number | null;
    amount: number | null;
    currency: string;
    fxRateToKrw: number;
    realizedGainKrw: number;
    dividendIncomeKrw: number;
    notes: string | null;
  }
): Promise<AssetTransaction> {
  const id = randomUUID();
  const result = await client.query<AssetTransaction>(
    `WITH inserted AS (
     INSERT INTO asset_transactions (
         id, asset_id, position_key, account_id, transaction_type, transaction_date, quantity, price, amount,
         currency, fx_rate_to_krw, realized_gain_krw, dividend_income_krw, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *
     )
     SELECT ${transactionColumns.replaceAll("t.", "i.")}
     FROM inserted i
     JOIN asset_accounts ac ON ac.id = i.account_id
     LEFT JOIN asset_items ai ON ai.id = i.asset_id`,
    [
      id,
      input.assetId,
      input.positionKey ?? null,
      input.accountId,
      input.transactionType,
      input.transactionDate,
      input.quantity,
      input.price,
      input.amount,
      input.currency,
      input.fxRateToKrw,
      input.realizedGainKrw,
      input.dividendIncomeKrw,
      input.notes
    ]
  );
  return result.rows[0];
}

async function updateAssetQuantityWithClient(
  client: pg.PoolClient,
  id: string,
  quantity: number,
  transactionDate: string,
  fxRateToKrw: number
): Promise<AssetWithAccount | null> {
  const result = await client.query<AssetWithAccount>(
    `WITH updated AS (
       UPDATE asset_items
       SET quantity = $2,
           fx_rate_to_krw = $4,
           last_price_error = NULL
       WHERE id = $1
       RETURNING
         id,
         account_id AS "accountId",
         type,
         name,
         market,
         ticker,
         currency,
         quantity::float AS "quantity",
         average_cost::float AS "averageCost",
         current_value::float AS "currentValue",
         $3::date::text AS "valuationDate",
         purchase_fx_rate_to_krw::float AS "purchaseFxRateToKrw",
         fx_rate_to_krw::float AS "fxRateToKrw",
         price_source AS "priceSource",
         last_price_at AS "lastPriceAt",
         last_price_error AS "lastPriceError",
         liquid_from::text AS "liquidFrom",
         maturity_date::text AS "maturityDate",
         maturity_amount::float AS "maturityAmount",
         maturity_currency AS "maturityCurrency",
         maturity_fx_rate_to_krw::float AS "maturityFxRateToKrw",
         auto_convert_on_maturity AS "autoConvertOnMaturity",
         matured_at AS "maturedAt",
         notes,
         created_at AS "createdAt"
     )
     SELECT
       u.*,
       ac.name AS "accountName",
       ac.institution,
       ac.liquidity_restricted AS "accountLiquidityRestricted",
       ac.liquidity_unlock_date::text AS "accountLiquidityUnlockDate",
       ac.liquidity_restriction_reason AS "accountLiquidityRestrictionReason"
     FROM updated u
     JOIN asset_accounts ac ON ac.id = u."accountId"`,
    [id, quantity, transactionDate, fxRateToKrw]
  );
  return result.rows[0] ?? null;
}

async function listMaturedBondLotsForUpdate(client: pg.PoolClient, targetDate: string): Promise<AssetWithAccount[]> {
  const result = await client.query<AssetWithAccount>(
    `SELECT ${assetColumns}
     FROM asset_items a
     JOIN asset_accounts ac ON ac.id = a.account_id
     WHERE a.type = 'bond'
       AND a.auto_convert_on_maturity = true
       AND a.maturity_date IS NOT NULL
       AND a.maturity_date <= $1
       AND a.maturity_amount IS NOT NULL
       AND a.maturity_amount > 0
       AND a.matured_at IS NULL
       AND (a.quantity IS NULL OR a.quantity > 0)
     ORDER BY a.maturity_date ASC, a.created_at ASC
     FOR UPDATE OF a`,
    [targetDate]
  );
  return result.rows;
}

async function addMaturityCashWithClient(
  client: pg.PoolClient,
  bond: AssetWithAccount,
  amount: number,
  currency: string,
  fxRateToKrw: number
): Promise<AssetWithAccount> {
  const existing = await findMaturityCashAssetForUpdate(client, bond.accountId, bond.market, currency);
  if (!existing) {
    return createAssetWithClient(client, {
      accountId: bond.accountId,
      type: "cash",
      name: "만기 현금",
      market: bond.market,
      ticker: null,
      currency,
      quantity: null,
      averageCost: null,
      currentValue: amount,
      valuationDate: bond.maturityDate ?? bond.valuationDate,
      purchaseFxRateToKrw: fxRateToKrw,
      fxRateToKrw,
      liquidFrom: bond.maturityDate ?? bond.valuationDate,
      notes: "채권 만기 상환금"
    });
  }

  return increaseCashValueWithClient(client, existing, amount, fxRateToKrw, bond.maturityDate ?? bond.valuationDate);
}

async function findMaturityCashAssetForUpdate(
  client: pg.PoolClient,
  accountId: string,
  market: string,
  currency: string
): Promise<AssetWithAccount | null> {
  const result = await client.query<AssetWithAccount>(
    `SELECT ${assetColumns}
     FROM asset_items a
     JOIN asset_accounts ac ON ac.id = a.account_id
     WHERE a.account_id = $1
       AND a.type = 'cash'
       AND a.market = $2
       AND a.currency = $3
       AND a.name = '만기 현금'
     ORDER BY a.created_at ASC
     LIMIT 1
     FOR UPDATE OF a`,
    [accountId, market, currency]
  );
  return result.rows[0] ?? null;
}

async function increaseCashValueWithClient(
  client: pg.PoolClient,
  asset: AssetWithAccount,
  amount: number,
  fxRateToKrw: number,
  valuationDate: string
): Promise<AssetWithAccount> {
  const currentValue = asset.currentValue ?? 0;
  const nextValue = currentValue + amount;
  const nextPurchaseFxRate =
    nextValue > 0 ? (currentValue * asset.purchaseFxRateToKrw + amount * fxRateToKrw) / nextValue : fxRateToKrw;
  const updated = await updateCashValueWithClient(client, asset.id, nextValue, nextPurchaseFxRate, fxRateToKrw, valuationDate);
  if (!updated) throw new Error("만기 현금 자산을 업데이트하지 못했습니다.");
  await saveAssetSnapshotWithClient(client, updated);
  return updated;
}

async function reduceCashMaturityValueWithClient(
  client: pg.PoolClient,
  assetId: string,
  amount: number,
  valuationDate: string
): Promise<void> {
  const asset = await getAssetById(client, assetId);
  if (!asset) return;

  const nextValue = Math.max(0, (asset.currentValue ?? 0) - amount);
  const updated = await updateCashValueWithClient(
    client,
    asset.id,
    nextValue,
    asset.purchaseFxRateToKrw,
    asset.fxRateToKrw,
    valuationDate
  );
  if (updated) await saveAssetSnapshotWithClient(client, updated);
}

async function updateCashValueWithClient(
  client: pg.PoolClient,
  id: string,
  currentValue: number,
  purchaseFxRateToKrw: number,
  fxRateToKrw: number,
  valuationDate: string
): Promise<AssetWithAccount | null> {
  const result = await client.query<AssetWithAccount>(
    `WITH updated AS (
       UPDATE asset_items
       SET current_value = $2,
           purchase_fx_rate_to_krw = $3,
           fx_rate_to_krw = $4,
           valuation_date = $5,
           liquid_from = LEAST(liquid_from, $5),
           last_price_error = NULL
       WHERE id = $1
       RETURNING
         id,
         account_id AS "accountId",
         type,
         name,
         market,
         ticker,
         currency,
         quantity::float AS "quantity",
         average_cost::float AS "averageCost",
         current_value::float AS "currentValue",
         valuation_date::text AS "valuationDate",
         purchase_fx_rate_to_krw::float AS "purchaseFxRateToKrw",
         fx_rate_to_krw::float AS "fxRateToKrw",
         price_source AS "priceSource",
         last_price_at AS "lastPriceAt",
         last_price_error AS "lastPriceError",
         liquid_from::text AS "liquidFrom",
         maturity_date::text AS "maturityDate",
         maturity_amount::float AS "maturityAmount",
         maturity_currency AS "maturityCurrency",
         maturity_fx_rate_to_krw::float AS "maturityFxRateToKrw",
         auto_convert_on_maturity AS "autoConvertOnMaturity",
         matured_at AS "maturedAt",
         notes,
         created_at AS "createdAt"
     )
     SELECT
       u.*,
       ac.name AS "accountName",
       ac.institution,
       ac.liquidity_restricted AS "accountLiquidityRestricted",
       ac.liquidity_unlock_date::text AS "accountLiquidityUnlockDate",
       ac.liquidity_restriction_reason AS "accountLiquidityRestrictionReason"
     FROM updated u
     JOIN asset_accounts ac ON ac.id = u."accountId"`,
    [id, currentValue, purchaseFxRateToKrw, fxRateToKrw, valuationDate]
  );
  return result.rows[0] ?? null;
}

async function resolveTransactionLots(
  client: pg.PoolClient,
  input: { assetId: string | null; positionKey: string | null }
): Promise<AssetWithAccount[]> {
  if (input.positionKey) {
    const lots = await listOpenLotsForUpdate(client);
    return lots.filter((asset) => assetPositionKey(asset) === input.positionKey);
  }

  if (!input.assetId) return [];
  const result = await client.query<AssetWithAccount>(
    `SELECT ${assetColumns}
     FROM asset_items a
     JOIN asset_accounts ac ON ac.id = a.account_id
     WHERE a.id = $1
     FOR UPDATE OF a`,
    [input.assetId]
  );
  return result.rows;
}

async function listOpenLotsForUpdate(client: pg.PoolClient): Promise<AssetWithAccount[]> {
  const result = await client.query<AssetWithAccount>(
    `SELECT ${assetColumns}
     FROM asset_items a
     JOIN asset_accounts ac ON ac.id = a.account_id
     WHERE (
       (a.quantity IS NOT NULL AND a.quantity > 0)
       OR (a.quantity IS NULL AND COALESCE(a.current_value, 0) > 0)
     )
     ORDER BY a.valuation_date ASC, a.created_at ASC
     FOR UPDATE OF a`
  );
  return result.rows;
}

async function applyFifoSellLots(
  client: pg.PoolClient,
  lots: AssetWithAccount[],
  sellQuantity: number,
  sellPrice: number,
  transactionDate: string,
  fxRateToKrw: number
): Promise<Array<{ assetId: string; quantity: number; realizedGainKrw: number }>> {
  let remaining = sellQuantity;
  const deductions: Array<{ assetId: string; quantity: number; realizedGainKrw: number }> = [];

  for (const lot of [...lots].sort((a, b) => a.valuationDate.localeCompare(b.valuationDate) || compareCreatedAt(a.createdAt, b.createdAt))) {
    if (remaining <= 0) break;
    const available = lot.quantity ?? 0;
    if (available <= 0) continue;

    const quantity = Math.min(available, remaining);
    remaining -= quantity;
    const updatedAsset = await updateAssetQuantityWithClient(
      client,
      lot.id,
      available - quantity,
      transactionDate,
      fxRateToKrw
    );
    if (updatedAsset) await saveAssetSnapshotWithClient(client, updatedAsset);
    const lotCostKrw = quantity * (lot.averageCost ?? 0) * lot.purchaseFxRateToKrw;
    const proceedsKrw = quantity * sellPrice * fxRateToKrw;
    deductions.push({
      assetId: lot.id,
      quantity,
      realizedGainKrw: Math.round(proceedsKrw - lotCostKrw)
    });
  }

  if (remaining > 0.000001) {
    throw new Error("보유 수량보다 많이 매도할 수 없습니다.");
  }

  return deductions;
}

function compareCreatedAt(left: string | Date, right: string | Date): number {
  return new Date(left).getTime() - new Date(right).getTime();
}

async function insertTransactionLots(
  client: pg.PoolClient,
  transactionId: string,
  lots: Array<{ assetId: string; quantity: number; realizedGainKrw: number }>
): Promise<void> {
  for (const lot of lots) {
    await client.query(
      `INSERT INTO asset_transaction_lots (transaction_id, asset_id, quantity, realized_gain_krw)
       VALUES ($1, $2, $3, $4)`,
      [transactionId, lot.assetId, lot.quantity, lot.realizedGainKrw]
    );
  }
}

async function insertCashLink(client: pg.PoolClient, transactionId: string, assetId: string, amount: number): Promise<void> {
  await client.query(
    `INSERT INTO asset_transaction_cash_links (transaction_id, asset_id, amount)
     VALUES ($1, $2, $3)`,
    [transactionId, assetId, amount]
  );
}

function estimateNativeAmount(quantity: number | null, priceOrAmount: number | null) {
  if (quantity !== null && priceOrAmount !== null) {
    return quantity * priceOrAmount;
  }
  return priceOrAmount;
}

function aggregatePositions(assets: AssetValuation[]): AssetPosition[] {
  const groups = assets.reduce<Map<string, AssetValuation[]>>((acc, asset) => {
    const key = assetPositionKey(asset);
    acc.set(key, [...(acc.get(key) ?? []), asset]);
    return acc;
  }, new Map());

  return Array.from(groups.entries())
    .map(([positionKey, group]) => aggregatePositionGroup(positionKey, group))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function aggregatePositionGroup(positionKey: string, group: AssetValuation[]): AssetPosition {
  const sortedByDate = [...group].sort((a, b) => a.valuationDate.localeCompare(b.valuationDate));
  const latest = [...group].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const totalQuantity = sumNullable(group.map((asset) => asset.quantity));
  const nativeCost = group.reduce((sum, asset) => sum + estimateAssetNativeCost(asset), 0);
  const nativeValue = group.reduce((sum, asset) => sum + estimateAssetNativeValue(asset), 0);
  const totalValueKrw = Math.round(group.reduce((sum, asset) => sum + asset.valueKrw, 0));
  const totalCostKrw = Math.round(group.reduce((sum, asset) => sum + asset.costKrw, 0));
  const gainKrw = totalValueKrw - totalCostKrw;

  return {
    ...latest,
    id: `position:${positionKey}`,
    positionKey,
    quantity: totalQuantity,
    averageCost: totalQuantity !== null && totalQuantity > 0 && nativeCost > 0 ? roundNumber(nativeCost / totalQuantity, 4) : null,
    currentValue:
      totalQuantity !== null && totalQuantity > 0 && nativeValue > 0
        ? roundNumber(nativeValue / totalQuantity, 4)
        : roundNumber(nativeValue, 4),
    purchaseFxRateToKrw: nativeCost > 0 ? roundNumber(totalCostKrw / nativeCost, 4) : latest.purchaseFxRateToKrw,
    fxRateToKrw: nativeValue > 0 ? roundNumber(totalValueKrw / nativeValue, 4) : latest.fxRateToKrw,
    valuationDate: sortedByDate[0].valuationDate,
    liquidFrom: group.reduce((maxDate, asset) => (asset.liquidFrom > maxDate ? asset.liquidFrom : maxDate), group[0].liquidFrom),
    maturityDate: latestNonNull(group.map((asset) => asset.maturityDate)),
    maturityAmount: sumNullable(group.map((asset) => asset.maturityAmount)),
    maturityCurrency: latest.maturityCurrency,
    maturityFxRateToKrw: latest.maturityFxRateToKrw,
    autoConvertOnMaturity: group.some((asset) => asset.autoConvertOnMaturity),
    maturedAt: latestNonNull(group.map((asset) => asset.maturedAt)),
    priceSource: aggregatePriceSource(group),
    lastPriceAt: latestNonNull(group.map((asset) => asset.lastPriceAt)),
    lastPriceError: group.find((asset) => asset.lastPriceError)?.lastPriceError ?? null,
    createdAt: latest.createdAt,
    valueKrw: totalValueKrw,
    costKrw: totalCostKrw,
    gainKrw,
    gainRate: totalCostKrw > 0 ? roundNumber((gainKrw / totalCostKrw) * 100, 1) : null,
    isLiquidByDate: group.every((asset) => asset.isLiquidByDate),
    lotCount: group.length,
    lotIds: group.map((asset) => asset.id),
    firstValuationDate: sortedByDate[0].valuationDate,
    latestValuationDate: sortedByDate[sortedByDate.length - 1].valuationDate
  };
}

function assetPositionKey(
  asset: Pick<AssetWithAccount, "accountId" | "type" | "market" | "ticker" | "currency" | "name" | "maturityDate">
) {
  const ticker = asset.ticker?.trim();
  const maturityPart = asset.type === "bond" && asset.maturityDate ? `:maturity:${asset.maturityDate}` : "";
  const identity = ticker
    ? `ticker:${asset.market}:${ticker.toUpperCase()}${maturityPart}`
    : `name:${asset.type}:${asset.market}:${asset.currency}:${normalizeAssetName(asset.name)}${maturityPart}`;

  return `${asset.accountId}:${identity}`;
}

function normalizeAssetName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function sumNullable(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function latestNonNull(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function aggregatePriceSource(group: Array<Pick<AssetValuation, "priceSource">>): PriceSource {
  if (group.some((asset) => asset.priceSource === "yahoo")) return "yahoo";
  if (group.some((asset) => asset.priceSource === "stooq")) return "stooq";
  return "manual";
}

function roundNumber(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function estimateAssetNativeValue(asset: AssetValuation) {
  if (asset.quantity !== null) {
    if (asset.currentValue !== null) return asset.currentValue * asset.quantity;
    if (asset.averageCost !== null) return asset.averageCost * asset.quantity;
  }

  return asset.currentValue ?? 0;
}

function estimateAssetNativeCost(asset: AssetValuation) {
  if (asset.quantity !== null && asset.averageCost !== null) {
    return asset.quantity * asset.averageCost;
  }

  return estimateAssetNativeValue(asset);
}

export async function listStoredHistory(startDate: string, endDate: string, assetIds: string[]): Promise<HistoryPoint[]> {
  if (assetIds.length === 0) {
    return [];
  }

  const result = await pool.query<HistoryPoint>(
    `WITH required_assets AS (
       SELECT unnest($3::text[]) AS asset_id
     )
     SELECT
       h.valuation_date::text AS "date",
       COALESCE(SUM(h.value_krw), 0)::float AS "totalValueKrw",
       COALESCE(SUM(CASE WHEN a.liquid_from <= h.valuation_date THEN h.value_krw ELSE 0 END), 0)::float AS "liquidValueKrw",
       (COALESCE(SUM(h.value_krw), 0) - COALESCE(SUM(CASE WHEN a.liquid_from <= h.valuation_date THEN h.value_krw ELSE 0 END), 0))::float AS "lockedValueKrw",
       COALESCE(SUM(h.cost_krw), 0)::float AS "totalCostKrw",
       (COALESCE(SUM(h.value_krw), 0) - COALESCE(SUM(h.cost_krw), 0))::float AS "gainKrw",
       CASE
         WHEN COALESCE(SUM(h.cost_krw), 0) > 0
           THEN ROUND(((COALESCE(SUM(h.value_krw), 0) - COALESCE(SUM(h.cost_krw), 0)) / COALESCE(SUM(h.cost_krw), 0) * 100)::numeric, 1)::float
         ELSE NULL
       END AS "gainRate",
       0::float AS "realizedGainKrw",
       0::float AS "dividendIncomeKrw",
       (COALESCE(SUM(h.value_krw), 0) - COALESCE(SUM(h.cost_krw), 0))::float AS "totalIncomeKrw"
     FROM asset_value_history h
     JOIN asset_items a ON a.id = h.asset_id
     JOIN required_assets r ON r.asset_id = h.asset_id
     WHERE h.valuation_date BETWEEN $1 AND $2
     GROUP BY h.valuation_date
     HAVING COUNT(DISTINCT h.asset_id) = (SELECT COUNT(*) FROM required_assets)
     ORDER BY h.valuation_date ASC`,
    [startDate, endDate, assetIds]
  );
  return result.rows;
}
