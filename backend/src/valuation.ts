import type { AssetWithAccount, AssetValuation, BreakdownItem, HistoryPoint } from "./types.js";

export function estimateAssetValueKrw(
  asset: Pick<AssetWithAccount, "type" | "currentValue" | "quantity" | "averageCost" | "fxRateToKrw">
): number {
  const baseValue = estimateBaseValue(asset);

  return roundKrw(baseValue * asset.fxRateToKrw);
}

export function estimateAssetCostKrw(
  asset: Pick<AssetWithAccount, "type" | "currentValue" | "quantity" | "averageCost" | "purchaseFxRateToKrw">
): number {
  if (asset.quantity !== null && asset.averageCost !== null) {
    return roundKrw(asset.quantity * asset.averageCost * asset.purchaseFxRateToKrw);
  }

  if (asset.type === "cash" || asset.type === "real_estate" || asset.type === "bond" || asset.type === "dividend") {
    return roundKrw((asset.currentValue ?? 0) * asset.purchaseFxRateToKrw);
  }

  return 0;
}

export function isLiquidBy(asset: Pick<AssetWithAccount, "liquidFrom">, targetDate: string): boolean {
  return asset.liquidFrom <= targetDate;
}

export function valueAssetsForDate(assets: AssetWithAccount[], targetDate: string): AssetValuation[] {
  return assets.map((asset) => {
    const valueKrw = estimateAssetValueKrw(asset);
    const costKrw = estimateAssetCostKrw(asset);
    const gainKrw = roundKrw(valueKrw - costKrw);

    return {
      ...asset,
      valueKrw,
      costKrw,
      gainKrw,
      gainRate: costKrw > 0 ? roundRate((gainKrw / costKrw) * 100) : null,
      isLiquidByDate: isLiquidBy(asset, targetDate)
    };
  });
}

export function summarizeByDate(
  assets: AssetWithAccount[],
  targetDate: string,
  income: { realizedGainKrw?: number; dividendIncomeKrw?: number } = {}
) {
  const valued = valueAssetsForDate(assets, targetDate);
  const liquidAssets = valued.filter((asset) => asset.isLiquidByDate);
  const totalValueKrw = roundKrw(valued.reduce((sum, asset) => sum + asset.valueKrw, 0));
  const totalCostKrw = roundKrw(valued.reduce((sum, asset) => sum + asset.costKrw, 0));
  const unrealizedGainKrw = roundKrw(totalValueKrw - totalCostKrw);
  const realizedGainKrw = roundKrw(income.realizedGainKrw ?? 0);
  const dividendIncomeKrw = roundKrw(income.dividendIncomeKrw ?? 0);
  const totalGainKrw = roundKrw(unrealizedGainKrw + realizedGainKrw + dividendIncomeKrw);
  const liquidValueKrw = roundKrw(liquidAssets.reduce((sum, asset) => sum + asset.valueKrw, 0));

  return {
    date: targetDate,
    totalValueKrw,
    totalCostKrw,
    totalGainKrw,
    totalGainRate: totalCostKrw > 0 ? roundRate((unrealizedGainKrw / totalCostKrw) * 100) : null,
    unrealizedGainKrw,
    realizedGainKrw,
    dividendIncomeKrw,
    totalIncomeKrw: totalGainKrw,
    liquidValueKrw,
    lockedValueKrw: roundKrw(totalValueKrw - liquidValueKrw),
    liquidRatio: totalValueKrw > 0 ? roundRate((liquidValueKrw / totalValueKrw) * 100) : 0,
    byType: groupSum(valued, (asset) => asset.type),
    byAccount: groupSum(valued, (asset) => asset.accountName),
    liquidByType: groupSum(liquidAssets, (asset) => asset.type),
    liquidByAccount: groupSum(liquidAssets, (asset) => asset.accountName),
    byTypeDetails: groupBreakdown(valued, (asset) => asset.type, (asset) => asset.type, totalValueKrw),
    byAccountDetails: groupBreakdown(valued, (asset) => asset.accountName, (asset) => asset.accountName, totalValueKrw),
    assets: valued
  };
}

export function buildProjectionHistory(
  assets: AssetWithAccount[],
  endDate: string,
  days: number,
  incomesByDate: Record<string, { realizedGainKrw: number; dividendIncomeKrw: number }> = {},
  initialIncome: { realizedGainKrw?: number; dividendIncomeKrw?: number } = {}
): HistoryPoint[] {
  let realizedGainKrw = initialIncome.realizedGainKrw ?? 0;
  let dividendIncomeKrw = initialIncome.dividendIncomeKrw ?? 0;
  return eachDate(endDate, days).map((date) => {
    realizedGainKrw += incomesByDate[date]?.realizedGainKrw ?? 0;
    dividendIncomeKrw += incomesByDate[date]?.dividendIncomeKrw ?? 0;
    const summary = summarizeByDate(assets, date, { realizedGainKrw, dividendIncomeKrw });
    return {
      date,
      totalValueKrw: summary.totalValueKrw,
      liquidValueKrw: summary.liquidValueKrw,
      lockedValueKrw: summary.lockedValueKrw,
      totalCostKrw: summary.totalCostKrw,
      gainKrw: summary.totalGainKrw,
      gainRate: summary.totalGainRate,
      realizedGainKrw: summary.realizedGainKrw,
      dividendIncomeKrw: summary.dividendIncomeKrw,
      totalIncomeKrw: summary.totalIncomeKrw
    };
  });
}

export function mergeHistoryPoints(projection: HistoryPoint[], stored: HistoryPoint[]): HistoryPoint[] {
  const storedByDate = new Map(stored.map((point) => [point.date, point]));

  return projection.map((point) => {
    const storedPoint = storedByDate.get(point.date);
    if (!storedPoint) return point;

    const unrealizedGainKrw = storedPoint.totalValueKrw - storedPoint.totalCostKrw;
    const totalIncomeKrw = roundKrw(unrealizedGainKrw + point.realizedGainKrw + point.dividendIncomeKrw);

    return {
      ...point,
      totalValueKrw: storedPoint.totalValueKrw,
      liquidValueKrw: storedPoint.liquidValueKrw,
      lockedValueKrw: storedPoint.lockedValueKrw,
      totalCostKrw: storedPoint.totalCostKrw,
      gainKrw: totalIncomeKrw,
      gainRate: storedPoint.gainRate,
      totalIncomeKrw
    };
  });
}

function estimateBaseValue(asset: Pick<AssetWithAccount, "type" | "currentValue" | "quantity" | "averageCost">): number {
  if (asset.currentValue !== null && asset.quantity !== null) {
    return asset.currentValue * asset.quantity;
  }

  if (asset.quantity !== null && asset.averageCost !== null) {
    return asset.quantity * asset.averageCost;
  }

  return asset.currentValue ?? 0;
}

function groupBreakdown(
  items: AssetValuation[],
  keyFn: (item: AssetValuation) => string,
  labelFn: (item: AssetValuation) => string,
  totalValueKrw: number
): BreakdownItem[] {
  const groups = items.reduce<Record<string, BreakdownItem>>((acc, item) => {
    const key = keyFn(item);
    const current = acc[key] ?? {
      key,
      label: labelFn(item),
      valueKrw: 0,
      costKrw: 0,
      gainKrw: 0,
      gainRate: null,
      share: 0,
      liquidValueKrw: 0
    };

    current.valueKrw = roundKrw(current.valueKrw + item.valueKrw);
    current.costKrw = roundKrw(current.costKrw + item.costKrw);
    current.gainKrw = roundKrw(current.gainKrw + item.gainKrw);
    current.liquidValueKrw = roundKrw(current.liquidValueKrw + (item.isLiquidByDate ? item.valueKrw : 0));
    acc[key] = current;
    return acc;
  }, {});

  return Object.values(groups)
    .map((item) => ({
      ...item,
      gainRate: item.costKrw > 0 ? roundRate((item.gainKrw / item.costKrw) * 100) : null,
      share: totalValueKrw > 0 ? roundRate((item.valueKrw / totalValueKrw) * 100) : 0
    }))
    .sort((a, b) => b.valueKrw - a.valueKrw);
}

function groupSum<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((groups, item) => {
    const key = keyFn(item);
    const value = (item as T & { valueKrw: number }).valueKrw;
    groups[key] = roundKrw((groups[key] ?? 0) + value);
    return groups;
  }, {});
}

function roundKrw(value: number): number {
  return Math.round(value);
}

function roundRate(value: number): number {
  return Math.round(value * 10) / 10;
}

function eachDate(endDate: string, days: number): string[] {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (days - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}
