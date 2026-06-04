import type { AssetType } from "./types";

type SimulationAssetAvailabilityInput = {
  type: AssetType;
  valuationDate: string;
  liquidFrom: string;
  maturityDate: string | null;
  accountLiquidityRestricted: boolean;
  accountLiquidityUnlockDate: string | null;
  accountLiquidityRestrictionReason: string | null;
};

type SimulationAssetRestriction = {
  date: string;
  blockReason: "asset" | "account";
  restrictionText: string;
};

export type SimulationAssetAvailability = {
  availableFrom: string | null;
  blockReason: "asset" | "account" | "unavailable";
  restrictionText: string;
};

export function simulationAssetAvailability(asset: SimulationAssetAvailabilityInput): SimulationAssetAvailability {
  const restrictions: SimulationAssetRestriction[] = [
    {
      date: asset.liquidFrom || asset.valuationDate,
      blockReason: "asset",
      restrictionText: "자산 제한"
    }
  ];

  if (asset.accountLiquidityRestricted) {
    if (!asset.accountLiquidityUnlockDate) {
      return {
        availableFrom: null,
        blockReason: "account",
        restrictionText: asset.accountLiquidityRestrictionReason || "계좌 제한"
      };
    }

    restrictions.push({
      date: asset.accountLiquidityUnlockDate,
      blockReason: "account",
      restrictionText: asset.accountLiquidityRestrictionReason || "계좌 제한"
    });
  }

  const latest = restrictions.reduce((currentLatest, restriction) => {
    if (restriction.date > currentLatest.date) return restriction;
    if (restriction.date === currentLatest.date && restriction.blockReason === "account") return restriction;
    return currentLatest;
  }, restrictions[0]);

  return {
    availableFrom: latest.date,
    blockReason: latest.blockReason,
    restrictionText: latest.date <= asset.valuationDate ? "제한 없음" : latest.restrictionText
  };
}

export function simulationAssetState(
  availableFrom: string | null,
  startDate: string,
  endDate: string
): "liquid" | "scheduled" | "unavailable" {
  if (!availableFrom) return "unavailable";
  if (availableFrom <= startDate) return "liquid";
  return availableFrom <= endDate ? "scheduled" : "unavailable";
}

export function isSimulationAssetAvailableOnDate(availableFrom: string | null, date: string) {
  return availableFrom !== null && availableFrom <= date;
}

export type MonthlySimulationPointGroup<T extends { date: string }> = {
  monthKey: string;
  periodStartDate: string;
  periodEndDate: string;
  representative: T;
  points: T[];
};

export function groupSimulationPointsByMonth<T extends { date: string }>(points: T[]): MonthlySimulationPointGroup<T>[] {
  const groups = new Map<string, T[]>();

  [...points]
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((point) => {
      const monthKey = point.date.slice(0, 7);
      groups.set(monthKey, [...(groups.get(monthKey) ?? []), point]);
    });

  return Array.from(groups.entries()).map(([monthKey, groupPoints]) => {
    const representative = groupPoints[groupPoints.length - 1];

    return {
      monthKey,
      periodStartDate: groupPoints[0].date,
      periodEndDate: representative.date,
      representative,
      points: groupPoints
    };
  });
}
