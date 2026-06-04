import type { AssetMarket, AssetType } from "./types";

type AssetIdentityInput = {
  id: string;
  accountId: string;
  accountName: string;
  type: AssetType;
  name: string;
  market: AssetMarket;
  ticker: string | null;
  currency: string;
  maturityDate: string | null;
};

export type UnrealizedGainAssetInput = AssetIdentityInput & {
  id: string;
  costKrw: number;
  gainKrw: number;
};

export type DividendTransactionInput = {
  id: string;
  assetId: string | null;
  positionKey: string | null;
  accountId: string;
  accountName: string;
  transactionDate: string;
  dividendIncomeKrw: number;
  assetName: string | null;
  ticker: string | null;
};

export type GroupedUnrealizedGainRow = {
  key: string;
  label: string;
  accountName: string;
  type: AssetType;
  ticker: string | null;
  amountKrw: number;
  costKrw: number;
  gainRate: number | null;
  count: number;
};

export type GroupedDividendIncomeRow = {
  key: string;
  label: string;
  accountName: string;
  amountKrw: number;
  count: number;
  firstDate: string;
  lastDate: string;
};

export function groupedUnrealizedGainRows(assets: UnrealizedGainAssetInput[]): GroupedUnrealizedGainRow[] {
  const grouped = assets.reduce<Map<string, GroupedUnrealizedGainRow>>((acc, asset) => {
    const key = assetMetricGroupKey(asset);
    const existing =
      acc.get(key) ??
      {
        key,
        label: asset.name,
        accountName: asset.accountName,
        type: asset.type,
        ticker: asset.ticker,
        amountKrw: 0,
        costKrw: 0,
        gainRate: null,
        count: 0
      };

    existing.amountKrw += asset.gainKrw;
    existing.costKrw += asset.costKrw;
    existing.count += 1;
    existing.gainRate = existing.costKrw > 0 ? roundRate((existing.amountKrw / existing.costKrw) * 100) : null;
    acc.set(key, existing);
    return acc;
  }, new Map());

  return Array.from(grouped.values())
    .filter((row) => row.amountKrw !== 0)
    .sort((a, b) => Math.abs(b.amountKrw) - Math.abs(a.amountKrw));
}

export function groupedDividendIncomeRows(
  transactions: DividendTransactionInput[],
  assets: AssetIdentityInput[]
): GroupedDividendIncomeRow[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const grouped = transactions.reduce<Map<string, GroupedDividendIncomeRow>>((acc, transaction) => {
    const linkedAsset = transaction.assetId ? assetById.get(transaction.assetId) ?? null : null;
    const key = dividendMetricGroupKey(transaction, linkedAsset);
    const existing =
      acc.get(key) ??
      {
        key,
        label: linkedAsset?.name ?? transaction.assetName ?? "자산",
        accountName: transaction.accountName,
        amountKrw: 0,
        count: 0,
        firstDate: transaction.transactionDate,
        lastDate: transaction.transactionDate
      };

    existing.amountKrw += transaction.dividendIncomeKrw;
    existing.count += 1;
    if (transaction.transactionDate < existing.firstDate) existing.firstDate = transaction.transactionDate;
    if (transaction.transactionDate > existing.lastDate) existing.lastDate = transaction.transactionDate;
    acc.set(key, existing);
    return acc;
  }, new Map());

  return Array.from(grouped.values())
    .filter((row) => row.amountKrw !== 0)
    .sort((a, b) => Math.abs(b.amountKrw) - Math.abs(a.amountKrw));
}

function dividendMetricGroupKey(transaction: DividendTransactionInput, linkedAsset: AssetIdentityInput | null) {
  if (linkedAsset) return assetMetricGroupKey(linkedAsset);
  if (transaction.positionKey) {
    return transaction.positionKey.startsWith(`${transaction.accountId}:`)
      ? transaction.positionKey
      : `${transaction.accountId}:${transaction.positionKey}`;
  }

  const ticker = transaction.ticker?.trim().toUpperCase();
  const fallbackIdentity = ticker ? `ticker:${ticker}` : `name:${normalizeMetricAssetName(transaction.assetName ?? "자산")}`;
  return `${transaction.accountId}:fallback:${fallbackIdentity}`;
}

function assetMetricGroupKey(asset: AssetIdentityInput) {
  return `${asset.accountId}:${assetMetricIdentity(asset)}`;
}

function assetMetricIdentity(asset: AssetIdentityInput) {
  const maturityPart = asset.type === "bond" && asset.maturityDate ? `:maturity:${asset.maturityDate}` : "";
  if (asset.ticker?.trim()) {
    return `ticker:${asset.market}:${asset.ticker.trim().toUpperCase()}${maturityPart}`;
  }

  return `name:${asset.type}:${asset.market}:${asset.currency}:${normalizeMetricAssetName(asset.name)}${maturityPart}`;
}

function normalizeMetricAssetName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function roundRate(value: number) {
  return Math.round(value * 10) / 10;
}
