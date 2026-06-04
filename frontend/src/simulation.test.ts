import { describe, expect, it } from "vitest";
import {
  groupSimulationPointsByMonth,
  isSimulationAssetAvailableOnDate,
  simulationAssetAvailability,
  simulationAssetState
} from "./simulation";
import type { AssetType } from "./types";

const baseAsset = {
  type: "stock" as AssetType,
  valuationDate: "2026-06-03",
  liquidFrom: "2026-06-03",
  maturityDate: null,
  accountLiquidityRestricted: false,
  accountLiquidityUnlockDate: null,
  accountLiquidityRestrictionReason: null
};

describe("simulation asset liquidity availability", () => {
  it("treats assets with past unlock dates as liquid from the simulation start", () => {
    const availability = simulationAssetAvailability({
      ...baseAsset,
      liquidFrom: "2026-01-30"
    });

    expect(availability.availableFrom).toBe("2026-01-30");
    expect(simulationAssetState(availability.availableFrom, "2026-06-03", "2027-06-03")).toBe("liquid");
    expect(isSimulationAssetAvailableOnDate(availability.availableFrom, "2026-06-03")).toBe(true);
  });

  it("unlocks an asset on the unlock date itself", () => {
    const availability = simulationAssetAvailability({
      ...baseAsset,
      liquidFrom: "2027-01-30"
    });

    expect(availability.availableFrom).toBe("2027-01-30");
    expect(simulationAssetState(availability.availableFrom, "2026-06-03", "2027-06-03")).toBe("scheduled");
    expect(isSimulationAssetAvailableOnDate(availability.availableFrom, "2027-01-29")).toBe(false);
    expect(isSimulationAssetAvailableOnDate(availability.availableFrom, "2027-01-30")).toBe(true);
  });

  it("keeps same-name lots independent when they unlock on different dates", () => {
    const samsungFirstLot = simulationAssetAvailability({
      ...baseAsset,
      liquidFrom: "2027-01-30"
    });
    const samsungSecondLot = simulationAssetAvailability({
      ...baseAsset,
      liquidFrom: "2027-03-20"
    });

    expect(isSimulationAssetAvailableOnDate(samsungFirstLot.availableFrom, "2027-01-30")).toBe(true);
    expect(isSimulationAssetAvailableOnDate(samsungSecondLot.availableFrom, "2027-01-30")).toBe(false);
    expect(isSimulationAssetAvailableOnDate(samsungSecondLot.availableFrom, "2027-03-20")).toBe(true);
  });

  it("uses the later account unlock date when account and asset restrictions overlap", () => {
    const availability = simulationAssetAvailability({
      ...baseAsset,
      liquidFrom: "2027-01-30",
      accountLiquidityRestricted: true,
      accountLiquidityUnlockDate: "2027-03-20",
      accountLiquidityRestrictionReason: "ISA"
    });

    expect(availability).toMatchObject({
      availableFrom: "2027-03-20",
      blockReason: "account",
      restrictionText: "ISA"
    });
  });

  it("keeps asset restriction as the reason when it unlocks later than the account", () => {
    const availability = simulationAssetAvailability({
      ...baseAsset,
      liquidFrom: "2027-03-20",
      accountLiquidityRestricted: true,
      accountLiquidityUnlockDate: "2027-01-30",
      accountLiquidityRestrictionReason: "ISA"
    });

    expect(availability).toMatchObject({
      availableFrom: "2027-03-20",
      blockReason: "asset",
      restrictionText: "자산 제한"
    });
  });

  it("treats restricted accounts without unlock dates as unavailable", () => {
    const availability = simulationAssetAvailability({
      ...baseAsset,
      accountLiquidityRestricted: true,
      accountLiquidityUnlockDate: null,
      accountLiquidityRestrictionReason: "해제일 미정"
    });

    expect(availability).toMatchObject({
      availableFrom: null,
      blockReason: "account",
      restrictionText: "해제일 미정"
    });
    expect(simulationAssetState(availability.availableFrom, "2026-06-03", "2027-06-03")).toBe("unavailable");
  });

  it("does not force bonds to stay locked until maturity when sale restriction is off", () => {
    const availability = simulationAssetAvailability({
      ...baseAsset,
      type: "bond",
      liquidFrom: "2026-06-03",
      maturityDate: "2027-06-30"
    });

    expect(availability).toMatchObject({
      availableFrom: "2026-06-03",
      blockReason: "asset",
      restrictionText: "제한 없음"
    });
    expect(simulationAssetState(availability.availableFrom, "2026-06-03", "2027-06-03")).toBe("liquid");
  });

  it("uses the sale restriction date for bonds instead of the maturity date", () => {
    const availability = simulationAssetAvailability({
      ...baseAsset,
      type: "bond",
      liquidFrom: "2027-01-30",
      maturityDate: "2027-06-30"
    });

    expect(availability).toMatchObject({
      availableFrom: "2027-01-30",
      blockReason: "asset",
      restrictionText: "자산 제한"
    });
  });
});

describe("monthly simulation point grouping", () => {
  it("groups multiple simulation dates in the same month under the last point", () => {
    const groups = groupSimulationPointsByMonth([
      { date: "2026-06-03", value: 100 },
      { date: "2026-06-20", value: 130 },
      { date: "2026-07-01", value: 150 }
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      monthKey: "2026-06",
      periodStartDate: "2026-06-03",
      periodEndDate: "2026-06-20",
      representative: { date: "2026-06-20", value: 130 }
    });
    expect(groups[0].points.map((point) => point.date)).toEqual(["2026-06-03", "2026-06-20"]);
  });

  it("sorts dates before grouping so keyboard navigation follows calendar order", () => {
    const groups = groupSimulationPointsByMonth([
      { date: "2026-08-15", value: 200 },
      { date: "2026-06-30", value: 100 },
      { date: "2026-07-31", value: 150 }
    ]);

    expect(groups.map((group) => group.periodEndDate)).toEqual(["2026-06-30", "2026-07-31", "2026-08-15"]);
  });
});
