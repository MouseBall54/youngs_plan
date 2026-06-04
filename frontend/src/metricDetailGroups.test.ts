import { describe, expect, it } from "vitest";
import { groupedDividendIncomeRows, groupedUnrealizedGainRows, type DividendTransactionInput, type UnrealizedGainAssetInput } from "./metricDetailGroups";

const baseAsset = {
  type: "stock" as const,
  name: "AAPL",
  market: "us" as const,
  ticker: "AAPL",
  currency: "USD",
  maturityDate: null
};

function asset(input: Partial<UnrealizedGainAssetInput> & Pick<UnrealizedGainAssetInput, "id" | "accountId" | "accountName" | "costKrw" | "gainKrw">): UnrealizedGainAssetInput {
  return {
    ...baseAsset,
    ...input
  };
}

function dividend(input: Partial<DividendTransactionInput> & Pick<DividendTransactionInput, "id" | "accountId" | "accountName" | "transactionDate" | "dividendIncomeKrw">): DividendTransactionInput {
  return {
    assetId: null,
    positionKey: null,
    assetName: "AAPL",
    ticker: "AAPL",
    ...input
  };
}

describe("grouped unrealized gain rows", () => {
  it("combines multiple lots for the same account and asset identity", () => {
    const rows = groupedUnrealizedGainRows([
      asset({ id: "a1", accountId: "acc-1", accountName: "Account 1", costKrw: 1000, gainKrw: 100 }),
      asset({ id: "a2", accountId: "acc-1", accountName: "Account 1", costKrw: 2000, gainKrw: -50 })
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "AAPL",
      accountName: "Account 1",
      amountKrw: 50,
      costKrw: 3000,
      gainRate: 1.7,
      count: 2
    });
  });

  it("keeps the same asset in different accounts separated", () => {
    const rows = groupedUnrealizedGainRows([
      asset({ id: "a1", accountId: "acc-1", accountName: "Account 1", costKrw: 1000, gainKrw: 100 }),
      asset({ id: "a2", accountId: "acc-2", accountName: "Account 2", costKrw: 1000, gainKrw: 90 })
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.accountName)).toEqual(["Account 1", "Account 2"]);
    expect(rows.reduce((sum, row) => sum + row.amountKrw, 0)).toBe(190);
  });

  it("keeps bonds with different maturity dates separated", () => {
    const rows = groupedUnrealizedGainRows([
      asset({ id: "b1", accountId: "acc-1", accountName: "Account 1", type: "bond", name: "Treasury", ticker: null, maturityDate: "2027-03-31", costKrw: 1000, gainKrw: 10 }),
      asset({ id: "b2", accountId: "acc-1", accountName: "Account 1", type: "bond", name: "Treasury", ticker: null, maturityDate: "2028-03-31", costKrw: 1000, gainKrw: 20 })
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.amountKrw, 0)).toBe(30);
  });
});

describe("grouped dividend income rows", () => {
  it("combines dividend transactions for the same account and asset identity", () => {
    const assets = [
      asset({ id: "a1", accountId: "acc-1", accountName: "Account 1", costKrw: 1000, gainKrw: 100 }),
      asset({ id: "a2", accountId: "acc-1", accountName: "Account 1", costKrw: 2000, gainKrw: 50 })
    ];
    const rows = groupedDividendIncomeRows(
      [
        dividend({ id: "d1", assetId: "a1", accountId: "acc-1", accountName: "Account 1", transactionDate: "2026-03-01", dividendIncomeKrw: 120 }),
        dividend({ id: "d2", assetId: "a2", accountId: "acc-1", accountName: "Account 1", transactionDate: "2026-06-01", dividendIncomeKrw: 80 })
      ],
      assets
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "AAPL",
      accountName: "Account 1",
      amountKrw: 200,
      count: 2,
      firstDate: "2026-03-01",
      lastDate: "2026-06-01"
    });
  });

  it("keeps dividend transactions in different accounts separated", () => {
    const rows = groupedDividendIncomeRows(
      [
        dividend({ id: "d1", accountId: "acc-1", accountName: "Account 1", transactionDate: "2026-03-01", dividendIncomeKrw: 120 }),
        dividend({ id: "d2", accountId: "acc-2", accountName: "Account 2", transactionDate: "2026-03-01", dividendIncomeKrw: 80 })
      ],
      []
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.accountName)).toEqual(["Account 1", "Account 2"]);
    expect(rows.reduce((sum, row) => sum + row.amountKrw, 0)).toBe(200);
  });

  it("falls back to account, name, and ticker when linked asset data is unavailable", () => {
    const rows = groupedDividendIncomeRows(
      [
        dividend({ id: "d1", accountId: "acc-1", accountName: "Account 1", transactionDate: "2026-03-01", dividendIncomeKrw: 120 }),
        dividend({ id: "d2", accountId: "acc-1", accountName: "Account 1", transactionDate: "2026-04-01", dividendIncomeKrw: 80 })
      ],
      []
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amountKrw: 200,
      count: 2,
      firstDate: "2026-03-01",
      lastDate: "2026-04-01"
    });
  });
});
