import type {
  AssetPriceHistory,
  AssetQuantityHistory,
  AssetWithAccount,
  AssetValuation,
  BreakdownItem,
  FxRateHistory,
  HistoryPoint
} from "./types.js";

export type HistoricalValuationData = {
  prices?: AssetPriceHistory[];
  fxRates?: FxRateHistory[];
  quantities?: AssetQuantityHistory[];
};

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

export function effectiveLiquidFrom(
  asset: Pick<AssetWithAccount, "liquidFrom" | "accountLiquidityRestricted" | "accountLiquidityUnlockDate">
): string {
  if (!asset.accountLiquidityRestricted || !asset.accountLiquidityUnlockDate) return asset.liquidFrom;
  return maxDate([asset.liquidFrom, asset.accountLiquidityUnlockDate]);
}

export function liquidityBlockReason(
  asset: Pick<AssetWithAccount, "liquidFrom" | "accountLiquidityRestricted" | "accountLiquidityUnlockDate">,
  targetDate: string
): "liquid" | "asset" | "account" {
  const effectiveDate = effectiveLiquidFrom(asset);
  if (effectiveDate <= targetDate) return "liquid";
  if (asset.accountLiquidityRestricted && asset.accountLiquidityUnlockDate && asset.accountLiquidityUnlockDate >= asset.liquidFrom) {
    return "account";
  }
  return "asset";
}

export function isLiquidBy(
  asset: Pick<AssetWithAccount, "liquidFrom" | "accountLiquidityRestricted" | "accountLiquidityUnlockDate">,
  targetDate: string
): boolean {
  return effectiveLiquidFrom(asset) <= targetDate;
}

export function valueAssetsForDate(
  assets: AssetWithAccount[],
  targetDate: string,
  historicalData: HistoricalValuationData = {}
): AssetValuation[] {
  const priceLookup = buildSortedHistoricalLookup(historicalData.prices ?? [], (item) => `${item.market}:${item.ticker.toUpperCase()}`);
  const fxLookup = buildSortedHistoricalLookup(
    historicalData.fxRates ?? [],
    (item) => `${item.baseCurrency.toUpperCase()}:${item.quoteCurrency.toUpperCase()}`
  );
  const quantityLookup = buildSortedHistoricalLookup(historicalData.quantities ?? [], (item) => item.assetId);

  return assets.map((asset) => {
    const historicalPrice = asset.ticker
      ? latestOnOrBefore(priceLookup.get(`${asset.market}:${asset.ticker.toUpperCase()}`) ?? [], targetDate)
      : undefined;
    const historicalFxRate =
      asset.currency.toUpperCase() === "USD" || asset.market === "us"
        ? latestOnOrBefore(fxLookup.get("USD:KRW") ?? [], targetDate)?.rate ?? asset.fxRateToKrw
        : asset.fxRateToKrw;
    const historicalQuantity = latestOnOrBefore(quantityLookup.get(asset.id) ?? [], targetDate)?.quantity;
    const valuedAsset = historicalPrice
      ? {
          ...asset,
          quantity: historicalQuantity ?? asset.quantity,
          currentValue: historicalPrice.closePrice,
          fxRateToKrw: historicalFxRate
        }
      : {
          ...asset,
          quantity: historicalQuantity ?? asset.quantity,
          fxRateToKrw: historicalFxRate
        };
    const isHeldByDate = targetDate >= asset.valuationDate;
    const valueKrw = isHeldByDate ? estimateAssetValueKrw(valuedAsset) : 0;
    const costKrw = isHeldByDate ? estimateAssetCostKrw(valuedAsset) : 0;
    const gainKrw = roundKrw(valueKrw - costKrw);
    const assetEffectiveLiquidFrom = effectiveLiquidFrom(asset);

    return {
      ...asset,
      valueKrw,
      costKrw,
      gainKrw,
      gainRate: costKrw > 0 ? roundRate((gainKrw / costKrw) * 100) : null,
      isLiquidByDate: assetEffectiveLiquidFrom <= targetDate,
      effectiveLiquidFrom: assetEffectiveLiquidFrom,
      liquidityBlockReason: liquidityBlockReason(asset, targetDate)
    };
  });
}

export function summarizeByDate(
  assets: AssetWithAccount[],
  targetDate: string,
  income: { realizedGainKrw?: number; dividendIncomeKrw?: number } = {},
  historicalData: HistoricalValuationData = {}
) {
  const valued = valueAssetsForDate(assets, targetDate, historicalData);
  const liquidAssets = valued.filter((asset) => asset.isLiquidByDate);
  const totalValueKrw = roundKrw(valued.reduce((sum, asset) => sum + asset.valueKrw, 0));
  const totalCostKrw = roundKrw(valued.reduce((sum, asset) => sum + asset.costKrw, 0));
  const unrealizedGainKrw = roundKrw(totalValueKrw - totalCostKrw);
  const realizedGainKrw = roundKrw(income.realizedGainKrw ?? 0);
  const dividendIncomeKrw = roundKrw(income.dividendIncomeKrw ?? 0);
  const totalGainKrw = roundKrw(unrealizedGainKrw + realizedGainKrw + dividendIncomeKrw);
  const liquidValueKrw = roundKrw(liquidAssets.reduce((sum, asset) => sum + asset.valueKrw, 0));
  const accountLockedValueKrw = roundKrw(
    valued.reduce((sum, asset) => sum + (asset.liquidityBlockReason === "account" ? asset.valueKrw : 0), 0)
  );
  const assetLockedValueKrw = roundKrw(
    valued.reduce((sum, asset) => sum + (asset.liquidityBlockReason === "asset" ? asset.valueKrw : 0), 0)
  );

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
    accountLockedValueKrw,
    assetLockedValueKrw,
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
  initialIncome: { realizedGainKrw?: number; dividendIncomeKrw?: number } = {},
  historicalData: HistoricalValuationData = {}
): HistoryPoint[] {
  let realizedGainKrw = initialIncome.realizedGainKrw ?? 0;
  let dividendIncomeKrw = initialIncome.dividendIncomeKrw ?? 0;
  return eachDate(endDate, days).map((date) => {
    realizedGainKrw += incomesByDate[date]?.realizedGainKrw ?? 0;
    dividendIncomeKrw += incomesByDate[date]?.dividendIncomeKrw ?? 0;
    const summary = summarizeByDate(assets, date, { realizedGainKrw, dividendIncomeKrw }, historicalData);
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

function buildSortedHistoricalLookup<T extends { priceDate?: string; rateDate?: string; date?: string }>(
  rows: T[],
  keyFn: (item: T) => string
): Map<string, T[]> {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }

  for (const [key, values] of byKey) {
    byKey.set(key, [...values].sort((a, b) => rowDate(a).localeCompare(rowDate(b))));
  }

  return byKey;
}

function latestOnOrBefore<T extends { priceDate?: string; rateDate?: string; date?: string }>(rows: T[], targetDate: string): T | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rowDate(rows[index]) <= targetDate) return rows[index];
  }
  return undefined;
}

function rowDate(row: { priceDate?: string; rateDate?: string; date?: string }) {
  return row.priceDate ?? row.rateDate ?? row.date ?? "";
}

function maxDate(dates: string[]) {
  return dates.reduce((max, date) => (date > max ? date : max));
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
