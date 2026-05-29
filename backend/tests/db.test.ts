import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
  await schemaClient.query(readFileSync(resolve(process.cwd(), "../db/schema.sql"), "utf8"));
  await schemaClient.end();

  process.env.DATABASE_URL = databaseUrl;
  db = await import("../src/db.js");
});

beforeEach(async () => {
  await db.pool.query(
    `TRUNCATE
       asset_transaction_cash_links,
       asset_transaction_lots,
       asset_transactions,
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
});

describe("history and price persistence", () => {
  it("keeps stored history for earlier dates after new assets are added", async () => {
    const account = await db.createAccount({ name: "Brokerage" });
    await db.createAsset(assetInput(account.id, { name: "First", valuationDate: "2026-01-01", currentValue: 1000 }));
    await db.createAsset(assetInput(account.id, { name: "Second", valuationDate: "2026-02-01", currentValue: 2000 }));

    const history = await db.listStoredHistory("2026-01-01", "2026-01-01");

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      date: "2026-01-01",
      totalValueKrw: 1000,
      totalCostKrw: 1000
    });
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

function withSearchPath(url: string, schema: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}
