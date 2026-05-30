import { describe, expect, it } from "vitest";
import { estimateAssetValueKrw, mergeHistoryPoints, summarizeByDate } from "../src/valuation.js";
import type { AssetWithAccount } from "../src/types.js";

const baseAsset: AssetWithAccount = {
  id: "asset-1",
  accountId: "account-1",
  accountName: "Brokerage",
  institution: "Sample",
  accountLiquidityRestricted: false,
  accountLiquidityUnlockDate: null,
  accountLiquidityRestrictionReason: null,
  type: "stock",
  name: "AAPL",
  market: "us",
  ticker: "AAPL",
  currency: "USD",
  quantity: 10,
  averageCost: 100,
  currentValue: null,
  valuationDate: "2026-05-29",
  purchaseFxRateToKrw: 1350,
  fxRateToKrw: 1350,
  liquidFrom: "2026-06-01",
  maturityDate: null,
  maturityAmount: null,
  maturityCurrency: null,
  maturityFxRateToKrw: null,
  autoConvertOnMaturity: true,
  maturedAt: null,
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

  it("uses stored historical USD price and FX rate for past valuation", () => {
    const summary = summarizeByDate([baseAsset], "2026-05-30", {}, {
      prices: [
        {
          market: "us",
          ticker: "AAPL",
          priceDate: "2026-05-29",
          closePrice: 120,
          currency: "USD",
          source: "yahoo",
          createdAt: "",
          updatedAt: ""
        }
      ],
      fxRates: [
        {
          baseCurrency: "USD",
          quoteCurrency: "KRW",
          rateDate: "2026-05-29",
          rate: 1400,
          source: "yahoo",
          createdAt: "",
          updatedAt: ""
        }
      ]
    });

    expect(summary.totalValueKrw).toBe(1_680_000);
    expect(summary.unrealizedGainKrw).toBe(330_000);
  });

  it("falls back to asset values when historical price or FX is missing", () => {
    const summary = summarizeByDate([baseAsset], "2026-05-30");

    expect(summary.totalValueKrw).toBe(1_350_000);
  });

  it("does not value an asset before its valuation date or after quantity reaches zero", () => {
    expect(summarizeByDate([baseAsset], "2026-05-28").totalValueKrw).toBe(0);
    expect(
      summarizeByDate([{ ...baseAsset, quantity: 10 }], "2026-05-30", {}, {
        quantities: [
          { assetId: "asset-1", date: "2026-05-29", quantity: 10 },
          { assetId: "asset-1", date: "2026-05-30", quantity: 0 }
        ]
      }).totalValueKrw
    ).toBe(0);
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

  it("uses the later date when an account also restricts liquidity", () => {
    const summary = summarizeByDate(
      [
        {
          ...baseAsset,
          liquidFrom: "2026-05-01",
          accountLiquidityRestricted: true,
          accountLiquidityUnlockDate: "2026-06-30",
          accountLiquidityRestrictionReason: "ISA"
        }
      ],
      "2026-05-30"
    );

    expect(summary.liquidValueKrw).toBe(0);
    expect(summary.accountLockedValueKrw).toBe(1_350_000);
    expect(summary.assetLockedValueKrw).toBe(0);
    expect(summary.assets[0].effectiveLiquidFrom).toBe("2026-06-30");
    expect(summary.assets[0].liquidityBlockReason).toBe("account");
  });

  it("treats restricted account assets as liquid after the account unlock date", () => {
    const summary = summarizeByDate(
      [
        {
          ...baseAsset,
          liquidFrom: "2026-05-01",
          accountLiquidityRestricted: true,
          accountLiquidityUnlockDate: "2026-06-30",
          accountLiquidityRestrictionReason: "ISA"
        }
      ],
      "2026-07-01"
    );

    expect(summary.liquidValueKrw).toBe(1_350_000);
    expect(summary.lockedValueKrw).toBe(0);
    expect(summary.accountLockedValueKrw).toBe(0);
    expect(summary.assets[0].liquidityBlockReason).toBe("liquid");
  });

  it("ignores account unlock dates when the account is not restricted", () => {
    const summary = summarizeByDate(
      [
        {
          ...baseAsset,
          liquidFrom: "2026-05-01",
          accountLiquidityRestricted: false,
          accountLiquidityUnlockDate: "2028-12-31",
          accountLiquidityRestrictionReason: "ISA"
        }
      ],
      "2026-05-30"
    );

    expect(summary.liquidValueKrw).toBe(1_350_000);
    expect(summary.lockedValueKrw).toBe(0);
    expect(summary.assets[0].effectiveLiquidFrom).toBe("2026-05-01");
  });

  it("keeps asset restriction as the reason when it unlocks later than the account", () => {
    const summary = summarizeByDate(
      [
        {
          ...baseAsset,
          liquidFrom: "2026-08-01",
          accountLiquidityRestricted: true,
          accountLiquidityUnlockDate: "2026-06-30",
          accountLiquidityRestrictionReason: "ISA"
        }
      ],
      "2026-05-30"
    );

    expect(summary.accountLockedValueKrw).toBe(0);
    expect(summary.assetLockedValueKrw).toBe(1_350_000);
    expect(summary.assets[0].effectiveLiquidFrom).toBe("2026-08-01");
    expect(summary.assets[0].liquidityBlockReason).toBe("asset");
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
