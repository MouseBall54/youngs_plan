import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildProjectionHistory, mergeHistoryPoints, summarizeByDate } from "../src/valuation.js";

let db: typeof import("../src/db.js");
let databaseUrl: string;
let schemaName: string;

beforeAll(async () => {
  const baseUrl = loadDatabaseUrl();
  schemaName = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  databaseUrl = withSearchPath(baseUrl, schemaName);

  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await admin.end();

  const schemaClient = new pg.Client({ connectionString: databaseUrl });
  await schemaClient.connect();
  await schemaClient.query(readSchemaSql());
  await schemaClient.end();

  process.env.DATABASE_URL = databaseUrl;
  db = await import("../src/db.js");
});

beforeEach(async () => {
  await db.pool.query(
     `TRUNCATE
       dashboard_snapshots,
       simulation_incomes,
       asset_transaction_cash_links,
       asset_transaction_lots,
       asset_transactions,
       fx_rate_history,
       asset_price_history,
       asset_value_history,
       asset_items,
       asset_accounts
     RESTART IDENTITY CASCADE`
  );
});

afterAll(async () => {
  await db?.pool.end();
  if (!schemaName) return;

  const admin = new pg.Client({ connectionString: loadDatabaseUrl() });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
});

describe("asset transactions", () => {
  it("creates and updates account liquidity restrictions", async () => {
    const account = await db.createAccount({
      name: "ISA",
      institution: "Brokerage",
      iconKey: "brokerage",
      liquidityRestricted: true,
      liquidityUnlockDate: "2028-12-31",
      liquidityRestrictionReason: "ISA"
    });

    expect(account.iconKey).toBe("brokerage");
    expect(account.liquidityRestricted).toBe(true);
    expect(account.liquidityUnlockDate).toBe("2028-12-31");
    expect(account.liquidityRestrictionReason).toBe("ISA");

    const updated = await db.updateAccount(account.id, {
      name: "ISA",
      institution: "Brokerage",
      iconKey: "pension",
      liquidityRestricted: false,
      liquidityUnlockDate: "2028-12-31",
      liquidityRestrictionReason: "ISA"
    });

    expect(updated?.iconKey).toBe("pension");
    expect(updated?.liquidityRestricted).toBe(false);
    expect(updated?.liquidityUnlockDate).toBeNull();
    expect(updated?.liquidityRestrictionReason).toBeNull();
  });

  it("keeps the original buy transaction when an update fails", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const buy = await db.createTransaction(buyInput(account.id, { name: "Original", ticker: "AAA" }));

    await expect(
      db.updateTransaction(buy.id, buyInput("missing-account", { name: "Replacement", ticker: "BBB" }))
    ).rejects.toThrow();

    const transactions = await db.listTransactions();
    const assets = await db.listAssets();
    expect(transactions.map((transaction) => transaction.id)).toContain(buy.id);
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe("Original");
  });

  it("keeps the original sell transaction and sold quantity when an update fails", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const buy = await db.createTransaction(buyInput(account.id, { quantity: 10, price: 100, ticker: "AAA" }));
    const sell = await db.createTransaction({
      transactionType: "sell",
      positionKey: buy.positionKey,
      quantity: 3,
      price: 150,
      currency: "KRW",
      fxRateToKrw: 1,
      transactionDate: "2026-01-10"
    });

    await expect(
      db.updateTransaction(sell.id, {
        transactionType: "sell",
        positionKey: buy.positionKey,
        quantity: 99,
        price: 150,
        currency: "KRW",
        fxRateToKrw: 1,
        transactionDate: "2026-01-10"
      })
    ).rejects.toThrow("보유 수량보다 많이 매도할 수 없습니다.");

    const transactions = await db.listTransactions();
    const [{ quantity }] = (
      await db.pool.query<{ quantity: number }>("SELECT quantity::float AS quantity FROM asset_items WHERE id = $1", [buy.assetId])
    ).rows;
    expect(transactions.map((transaction) => transaction.id)).toContain(sell.id);
    expect(quantity).toBe(7);
  });

  it("keeps the original dividend transaction when an update fails", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const buy = await db.createTransaction(buyInput(account.id, { ticker: "AAA" }));
    const dividend = await db.createTransaction({
      transactionType: "dividend",
      positionKey: buy.positionKey,
      amount: 10,
      currency: "KRW",
      fxRateToKrw: 1,
      transactionDate: "2026-01-10"
    });

    await expect(
      db.updateTransaction(dividend.id, {
        transactionType: "dividend",
        positionKey: buy.positionKey,
        amount: 0,
        currency: "KRW",
        fxRateToKrw: 1,
        transactionDate: "2026-01-10"
      })
    ).rejects.toThrow("배당금은 0보다 커야 합니다.");

    const transactions = await db.listTransactions();
    expect(transactions.map((transaction) => transaction.id)).toContain(dividend.id);
    expect(await db.transactionTotalsUntil("2026-01-10")).toMatchObject({ dividendIncomeKrw: 10 });
  });

  it("keeps transaction ids when updates succeed", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const buy = await db.createTransaction(buyInput(account.id, { name: "Original", ticker: "AAA", quantity: 10 }));
    const updatedBuy = await db.updateTransaction(
      buy.id,
      buyInput(account.id, { name: "Updated", ticker: "BBB", quantity: 12, price: 150 })
    );

    expect(updatedBuy?.id).toBe(buy.id);
    expect(updatedBuy?.assetName).toBe("Updated");

    const sell = await db.createTransaction({
      transactionType: "sell",
      positionKey: updatedBuy?.positionKey ?? "",
      quantity: 3,
      price: 200,
      currency: "KRW",
      fxRateToKrw: 1,
      transactionDate: "2026-01-10"
    });
    const updatedSell = await db.updateTransaction(sell.id, {
      transactionType: "sell",
      positionKey: updatedBuy?.positionKey ?? "",
      quantity: 4,
      price: 200,
      currency: "KRW",
      fxRateToKrw: 1,
      transactionDate: "2026-01-10"
    });

    const transactions = await db.listTransactions();
    const [{ quantity }] = (
      await db.pool.query<{ quantity: number }>("SELECT quantity::float AS quantity FROM asset_items WHERE id = $1", [updatedBuy?.assetId])
    ).rows;
    expect(updatedSell?.id).toBe(sell.id);
    expect(transactions.map((transaction) => transaction.id)).toEqual(expect.arrayContaining([buy.id, sell.id]));
    expect(quantity).toBe(8);
  });

  it("uses FIFO lots for sell gains and restores partial sells on delete", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const firstBuy = await db.createTransaction(buyInput(account.id, { quantity: 10, price: 100, ticker: "AAA" }));
    await db.createTransaction(buyInput(account.id, { quantity: 10, price: 200, ticker: "AAA", transactionDate: "2026-01-02" }));

    const sell = await db.createTransaction({
      transactionType: "sell",
      positionKey: firstBuy.positionKey,
      quantity: 15,
      price: 300,
      currency: "KRW",
      fxRateToKrw: 1,
      transactionDate: "2026-01-10"
    });

    const lots = (
      await db.pool.query<{ quantity: number; realizedGainKrw: number }>(
        `SELECT l.quantity::float AS quantity, l.realized_gain_krw::float AS "realizedGainKrw"
         FROM asset_transaction_lots l
         JOIN asset_items a ON a.id = l.asset_id
         WHERE l.transaction_id = $1
         ORDER BY a.valuation_date ASC`,
        [sell.id]
      )
    ).rows;
    expect(sell.realizedGainKrw).toBe(2_500);
    expect(lots).toEqual([
      { quantity: 10, realizedGainKrw: 2_000 },
      { quantity: 5, realizedGainKrw: 500 }
    ]);

    await db.deleteTransaction(sell.id);
    const restored = (
      await db.pool.query<{ quantity: number }>("SELECT quantity::float AS quantity FROM asset_items ORDER BY valuation_date ASC")
    ).rows;
    expect(restored.map((asset) => asset.quantity)).toEqual([10, 10]);
  });

  it("calculates dividend income in KRW", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const buy = await db.createTransaction(buyInput(account.id, { currency: "USD", fxRateToKrw: 1300, ticker: "AAA" }));

    const dividend = await db.createTransaction({
      transactionType: "dividend",
      positionKey: buy.positionKey,
      amount: 12,
      currency: "USD",
      fxRateToKrw: 1300,
      transactionDate: "2026-01-10"
    });

    expect(dividend.dividendIncomeKrw).toBe(15_600);
    expect(await db.transactionTotalsUntil("2026-01-10")).toMatchObject({ dividendIncomeKrw: 15_600 });
  });

  it("deletes zero-quantity buy transactions without requiring dependent transactions to be removed first", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const zeroBuy = await db.createTransaction(buyInput(account.id, { quantity: 0, price: 100, ticker: "AAA" }));
    await db.pool.query(
      `INSERT INTO asset_transactions (
         id, asset_id, position_key, account_id, transaction_type, transaction_date, amount, currency, fx_rate_to_krw, dividend_income_krw
       )
       VALUES ('dependent-dividend', $1, $2, $3, 'dividend', '2026-01-10', 10, 'KRW', 1, 10)`,
      [zeroBuy.assetId, zeroBuy.positionKey, account.id]
    );

    await expect(db.deleteTransaction(zeroBuy.id)).resolves.toBe(true);

    const rows = await db.listTransactions();
    expect(rows.map((transaction) => transaction.id)).not.toContain(zeroBuy.id);
    expect(rows.map((transaction) => transaction.id)).toContain("dependent-dividend");
  });

  it("does not keep generated initial buys when a real buy transaction exists for the asset", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const realBuy = await db.createTransaction(buyInput(account.id, { ticker: "AAA" }));
    const legacyAsset = await db.createAsset(assetInput(account.id, { name: "Legacy", type: "stock", quantity: 5, averageCost: 200 }));

    await db.pool.query(
      `INSERT INTO asset_transactions (
         id, asset_id, position_key, account_id, transaction_type, transaction_date, quantity, price, amount, currency, fx_rate_to_krw, notes
       )
       VALUES ($1, $2, $3, $4, 'buy', '2026-01-01', 10, 100, 1000, 'KRW', 1, '기존 자산 초기 매수 이력')`,
      [`initial-buy-${realBuy.assetId}`, realBuy.assetId, realBuy.positionKey, account.id]
    );

    await db.pool.query(readSchemaSql());

    const transactions = await db.listTransactions();
    const transactionIds = transactions.map((transaction) => transaction.id);
    expect(transactionIds).toContain(realBuy.id);
    expect(transactionIds).not.toContain(`initial-buy-${realBuy.assetId}`);
    expect(transactionIds).toContain(`initial-buy-${legacyAsset.id}`);
  });

  it("reconstructs quantity history from buy and sell lot events", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const buy = await db.createTransaction(buyInput(account.id, { quantity: 10, price: 100, ticker: "AAA" }));
    await db.createTransaction({
      transactionType: "sell",
      positionKey: buy.positionKey,
      quantity: 4,
      price: 120,
      currency: "KRW",
      fxRateToKrw: 1,
      transactionDate: "2026-01-10"
    });

    const rows = await db.listAssetQuantityHistory([buy.assetId ?? ""]);

    expect(rows).toEqual([
      { assetId: buy.assetId, date: "2026-01-01", quantity: 10 },
      { assetId: buy.assetId, date: "2026-01-10", quantity: 6 }
    ]);
  });
});

describe("history and price persistence", () => {
  it("creates, updates, lists, and deletes simulation incomes", async () => {
    const created = await db.createSimulationIncome({
      type: "monthly",
      name: "Salary",
      amountKrw: 1_000_000,
      startDate: "2026-06-01",
      endDate: null,
      repeatsIndefinitely: true,
      availability: "immediate",
      unlockDate: null,
      note: "base"
    });

    expect(await db.listSimulationIncomes()).toMatchObject([
      {
        id: created.id,
        type: "monthly",
        name: "Salary",
        amountKrw: 1_000_000,
        startDate: "2026-06-01",
        endDate: null,
        repeatsIndefinitely: true,
        availability: "immediate",
        unlockDate: null,
        note: "base"
      }
    ]);

    const updated = await db.updateSimulationIncome(created.id, {
      type: "one_time",
      name: "Bonus",
      amountKrw: 2_500_000,
      startDate: "2026-07-01",
      endDate: "2026-08-01",
      repeatsIndefinitely: true,
      availability: "unlock_date",
      unlockDate: "2026-09-01",
      note: "updated"
    });

    expect(updated).toMatchObject({
      type: "one_time",
      name: "Bonus",
      amountKrw: 2_500_000,
      startDate: "2026-07-01",
      endDate: null,
      repeatsIndefinitely: false,
      availability: "unlock_date",
      unlockDate: "2026-09-01",
      note: "updated"
    });
    expect(await db.deleteSimulationIncome(created.id)).toBe(true);
    expect(await db.listSimulationIncomes()).toHaveLength(0);
  });

  it("stores and returns the latest dashboard snapshot for a target date", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    await db.createAsset(assetInput(account.id, { name: "Cash", valuationDate: "2026-01-01", currentValue: 1000 }));
    const assets = await db.listAssets();
    const payload = {
      accounts: await db.listAccounts(),
      summary: summarizeByDate(assets, "2026-01-01"),
      positions: await db.listPositions("2026-01-01"),
      history: [],
      transactions: await db.listTransactions()
    };

    await db.saveDashboardSnapshot("2026-01-01", payload);
    const snapshot = await db.getDashboardSnapshot("2026-01-01");

    expect(snapshot?.targetDate).toBe("2026-01-01");
    expect(snapshot?.payload.summary.totalValueKrw).toBe(1000);
    expect(snapshot?.payload.accounts[0].name).toBe("Brokerage");
  });

  it("does not return partial stored history as a full portfolio point", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const first = await db.createAsset(assetInput(account.id, { name: "First", valuationDate: "2026-01-01", currentValue: 1000 }));
    const second = await db.createAsset(assetInput(account.id, { name: "Second", valuationDate: "2026-02-01", currentValue: 2000 }));

    const history = await db.listStoredHistory("2026-01-01", "2026-01-01", [first.id, second.id]);

    expect(history).toHaveLength(0);
  });

  it("returns stored history only when every portfolio asset has a snapshot for that date", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const first = await db.createAsset(assetInput(account.id, { name: "First", valuationDate: "2026-01-01", currentValue: 1000 }));
    const second = await db.createAsset(assetInput(account.id, { name: "Second", valuationDate: "2026-01-01", currentValue: 2000 }));

    const history = await db.listStoredHistory("2026-01-01", "2026-01-01", [first.id, second.id]);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      date: "2026-01-01",
      totalValueKrw: 3000,
      totalCostKrw: 3000
    });
  });

  it("keeps projected portfolio value when a buy date has only a partial stored snapshot", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    await db.createAsset(assetInput(account.id, {
      name: "전세금",
      type: "real_estate",
      quantity: 1,
      averageCost: 110_000_000,
      currentValue: 110_000_000,
      valuationDate: "2024-08-12",
      liquidFrom: "2027-08-12"
    }));
    await db.createAsset(assetInput(account.id, {
      name: "SHV",
      type: "bond",
      quantity: 23,
      averageCost: 110.37,
      currentValue: null,
      currency: "USD",
      purchaseFxRateToKrw: 1503.88,
      fxRateToKrw: 1503.88,
      valuationDate: "2026-04-29",
      liquidFrom: "2026-04-29"
    }));
    await db.createAsset(assetInput(account.id, {
      name: "파두",
      type: "stock",
      quantity: 1,
      averageCost: 127_100,
      currentValue: 111_400,
      valuationDate: "2026-05-22",
      liquidFrom: "2026-05-22"
    }));
    await db.createAsset(assetInput(account.id, {
      name: "파두",
      type: "stock",
      quantity: 17,
      averageCost: 115_100,
      currentValue: null,
      valuationDate: "2026-05-26",
      liquidFrom: "2026-05-26"
    }));

    const assets = await db.listAssets();
    const projection = buildProjectionHistory(assets, "2026-05-30", 30);
    const stored = await db.listStoredHistory("2026-05-01", "2026-05-30", assets.map((asset) => asset.id));
    const merged = mergeHistoryPoints(projection, stored);
    const point = merged.find((item) => item.date === "2026-05-22");

    expect(stored.find((item) => item.date === "2026-05-22")).toBeUndefined();
    expect(point?.totalValueKrw).toBeGreaterThan(110_000_000);
    expect(point?.totalValueKrw).not.toBe(111_400);
  });

  it("records quote sources and price refresh errors", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    const asset = await db.createAsset(assetInput(account.id, { ticker: "AAA" }));

    await db.updateAssetPrice({ id: asset.id, currentValue: 120, fxRateToKrw: 1, source: "yahoo" });
    await db.markAssetPriceError(asset.id, "가격 업데이트 실패");

    const [updated] = await db.listAssets();
    expect(updated.priceSource).toBe("yahoo");
    expect(updated.currentValue).toBe(120);
    expect(updated.lastPriceError).toBe("가격 업데이트 실패");
  });

  it("upserts and lists asset price history without duplicates", async () => {
    await db.upsertAssetPriceHistory({
      market: "us",
      ticker: "aaa",
      priceDate: "2026-01-02",
      closePrice: 100,
      currency: "USD",
      source: "yahoo"
    });
    await db.upsertAssetPriceHistory({
      market: "us",
      ticker: "AAA",
      priceDate: "2026-01-02",
      closePrice: 120,
      currency: "USD",
      source: "yahoo"
    });

    const rows = await db.listAssetPriceHistory("2026-01-01", "2026-01-03", [{ market: "us", ticker: "AAA" }]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ market: "us", ticker: "AAA", priceDate: "2026-01-02", closePrice: 120 });
  });

  it("upserts and lists fx rate history without duplicates", async () => {
    await db.upsertFxRateHistory({
      baseCurrency: "usd",
      quoteCurrency: "krw",
      rateDate: "2026-01-02",
      rate: 1300,
      source: "yahoo"
    });
    await db.upsertFxRateHistory({
      baseCurrency: "USD",
      quoteCurrency: "KRW",
      rateDate: "2026-01-02",
      rate: 1310,
      source: "yahoo"
    });

    const rows = await db.listFxRateHistory("USD", "KRW", "2026-01-01", "2026-01-03");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ baseCurrency: "USD", quoteCurrency: "KRW", rateDate: "2026-01-02", rate: 1310 });
  });
});

function buyInput(
  accountId: string,
  overrides: Partial<Parameters<typeof db.createTransaction>[0]> = {}
): Parameters<typeof db.createTransaction>[0] {
  return {
    transactionType: "buy",
    accountId,
    type: "stock",
    name: "Asset",
    market: "domestic",
    ticker: null,
    quantity: 10,
    price: 100,
    currentValue: 100,
    currency: "KRW",
    purchaseFxRateToKrw: 1,
    fxRateToKrw: 1,
    transactionDate: "2026-01-01",
    ...overrides
  };
}

function assetInput(
  accountId: string,
  overrides: Partial<Parameters<typeof db.createAsset>[0]> = {}
): Parameters<typeof db.createAsset>[0] {
  return {
    accountId,
    type: "cash",
    name: "Cash",
    market: "domestic",
    ticker: null,
    currency: "KRW",
    quantity: null,
    averageCost: null,
    currentValue: 1000,
    valuationDate: "2026-01-01",
    purchaseFxRateToKrw: 1,
    fxRateToKrw: 1,
    liquidFrom: "2026-01-01",
    ...overrides
  };
}

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = resolve(process.cwd(), "../.env");
  const env = readFileSync(envPath, "utf8");
  const line = env.split(/\r?\n/).find((item) => item.trim().startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL is not set.");

  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

function readSchemaSql() {
  return readFileSync(resolve(process.cwd(), "../db/schema.sql"), "utf8");
}

function withSearchPath(url: string, schema: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}
