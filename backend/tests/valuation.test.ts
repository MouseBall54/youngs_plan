import { describe, expect, it } from "vitest";
import { estimateAssetValueKrw, mergeHistoryPoints, summarizeByDate } from "../src/valuation.js";
import type { AssetWithAccount } from "../src/types.js";

const baseAsset: AssetWithAccount = {
  id: "asset-1",
  accountId: "account-1",
  accountName: "Brokerage",
  institution: "Sample",
  type: "stock",
  name: "AAPL",
  market: "us",
  currency: "USD",
  quantity: 10,
  averageCost: 100,
  currentValue: null,
  valuationDate: "2026-05-29",
  purchaseFxRateToKrw: 1350,
  fxRateToKrw: 1350,
  liquidFrom: "2026-06-01",
  notes: null,
  createdAt: "2026-05-29T00:00:00.000Z"
};

describe("valuation", () => {
  it("uses quantity, average cost, and exchange rate for stock value", () => {
    expect(estimateAssetValueKrw(baseAsset)).toBe(1_350_000);
  });

  it("uses current stock price before average cost when present", () => {
    expect(estimateAssetValueKrw({ ...baseAsset, currentValue: 120 })).toBe(1_620_000);
  });

  it("uses quantity pricing for ticker-like assets outside the stock category", () => {
    expect(estimateAssetValueKrw({ ...baseAsset, type: "bond", currentValue: 105 })).toBe(1_417_500);
  });

  it("summarizes liquid and locked values by target date", () => {
    const summary = summarizeByDate(
      [
        baseAsset,
        {
          ...baseAsset,
          id: "cash-1",
          type: "cash",
          name: "Deposit",
          currency: "KRW",
          quantity: null,
          averageCost: null,
          currentValue: 500_000,
          purchaseFxRateToKrw: 1,
          fxRateToKrw: 1,
          liquidFrom: "2026-05-01"
        }
      ],
      "2026-05-29"
    );

    expect(summary.totalValueKrw).toBe(1_850_000);
    expect(summary.liquidValueKrw).toBe(500_000);
    expect(summary.lockedValueKrw).toBe(1_350_000);
    expect(summary.byType.stock).toBe(1_350_000);
    expect(summary.byType.cash).toBe(500_000);
    expect(summary.byAccount.Brokerage).toBe(1_850_000);
    expect(summary.liquidByType.cash).toBe(500_000);
  });

  it("uses stored valuation snapshots without dropping projected income", () => {
    const [point] = mergeHistoryPoints(
      [
        {
          date: "2026-05-29",
          totalValueKrw: 200_000,
          liquidValueKrw: 200_000,
          lockedValueKrw: 0,
          totalCostKrw: 100_000,
          gainKrw: 130_000,
          gainRate: 100,
          realizedGainKrw: 20_000,
          dividendIncomeKrw: 10_000,
          totalIncomeKrw: 130_000
        }
      ],
      [
        {
          date: "2026-05-29",
          totalValueKrw: 250_000,
          liquidValueKrw: 150_000,
          lockedValueKrw: 100_000,
          totalCostKrw: 100_000,
          gainKrw: 150_000,
          gainRate: 150,
          realizedGainKrw: 0,
          dividendIncomeKrw: 0,
          totalIncomeKrw: 150_000
        }
      ]
    );

    expect(point.totalValueKrw).toBe(250_000);
    expect(point.liquidValueKrw).toBe(150_000);
    expect(point.realizedGainKrw).toBe(20_000);
    expect(point.dividendIncomeKrw).toBe(10_000);
    expect(point.gainKrw).toBe(180_000);
    expect(point.totalIncomeKrw).toBe(180_000);
  });
});
