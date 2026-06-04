export type AssetType = "stock" | "real_estate" | "cash" | "bond" | "dividend";
export type AssetMarket = "domestic" | "us" | "other";
export type TransactionType = "buy" | "sell" | "dividend" | "maturity" | "deposit";
export type PriceSource = "manual" | "yahoo" | "stooq";
export type SimulationIncomeType = "monthly" | "one_time";
export type SimulationAvailability = "immediate" | "unlock_date" | "unavailable";

export type Account = {
  id: string;
  name: string;
  institution: string | null;
  liquidityRestricted: boolean;
  liquidityUnlockDate: string | null;
  liquidityRestrictionReason: string | null;
  createdAt: string;
};

export type AssetValuation = {
  id: string;
  accountId: string;
  accountName: string;
  institution: string | null;
  accountLiquidityRestricted: boolean;
  accountLiquidityUnlockDate: string | null;
  accountLiquidityRestrictionReason: string | null;
  type: AssetType;
  name: string;
  market: AssetMarket;
  ticker: string | null;
  currency: string;
  quantity: number | null;
  averageCost: number | null;
  currentValue: number | null;
  valuationDate: string;
  purchaseFxRateToKrw: number;
  fxRateToKrw: number;
  priceSource: PriceSource;
  lastPriceAt: string | null;
  lastPriceError: string | null;
  liquidFrom: string;
  maturityDate: string | null;
  maturityAmount: number | null;
  maturityCurrency: string | null;
  maturityFxRateToKrw: number | null;
  autoConvertOnMaturity: boolean;
  maturedAt: string | null;
  notes: string | null;
  createdAt: string;
  valueKrw: number;
  costKrw: number;
  gainKrw: number;
  gainRate: number | null;
  isLiquidByDate: boolean;
  effectiveLiquidFrom: string;
  liquidityBlockReason: "liquid" | "asset" | "account";
  lotCount?: number;
  lotIds?: string[];
  firstValuationDate?: string;
  latestValuationDate?: string;
};

export type AssetPosition = AssetValuation & {
  positionKey: string;
  lotCount: number;
  lotIds: string[];
  firstValuationDate: string;
  latestValuationDate: string;
};

export type BreakdownItem = {
  key: string;
  label: string;
  valueKrw: number;
  costKrw: number;
  gainKrw: number;
  gainRate: number | null;
  share: number;
  liquidValueKrw: number;
};

export type Summary = {
  date: string;
  totalValueKrw: number;
  totalCostKrw: number;
  totalGainKrw: number;
  totalGainRate: number | null;
  unrealizedGainKrw: number;
  realizedGainKrw: number;
  dividendIncomeKrw: number;
  totalIncomeKrw: number;
  liquidValueKrw: number;
  lockedValueKrw: number;
  accountLockedValueKrw: number;
  assetLockedValueKrw: number;
  liquidRatio: number;
  byType: Record<string, number>;
  byAccount: Record<string, number>;
  liquidByType: Record<string, number>;
  liquidByAccount: Record<string, number>;
  byTypeDetails: BreakdownItem[];
  byAccountDetails: BreakdownItem[];
  assets: AssetValuation[];
};

export type HistoryPoint = {
  date: string;
  totalValueKrw: number;
  liquidValueKrw: number;
  lockedValueKrw: number;
  totalCostKrw: number;
  gainKrw: number;
  gainRate: number | null;
  realizedGainKrw: number;
  dividendIncomeKrw: number;
  totalIncomeKrw: number;
};

export type AssetTransaction = {
  id: string;
  assetId: string | null;
  positionKey: string | null;
  accountId: string;
  accountName: string;
  institution: string | null;
  transactionType: TransactionType;
  transactionDate: string;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  currency: string;
  fxRateToKrw: number;
  realizedGainKrw: number;
  dividendIncomeKrw: number;
  notes: string | null;
  createdAt: string;
  assetName: string | null;
  ticker: string | null;
};

export type HistoryResponse = {
  range: string;
  startDate?: string;
  endDate?: string;
  points: HistoryPoint[];
};

export type PriceRefreshResponse = {
  updatedAt: string;
  results: Array<{
    assetId: string;
    name: string;
    ticker: string | null;
    ok: boolean;
    price?: number;
    date?: string;
    source?: PriceSource;
    fxRateToKrw?: number;
    message?: string;
  }>;
};

export type PriceHistoryRefreshResponse = {
  updatedAt: string;
  startDate: string;
  endDate: string;
  results: Array<{
    ticker: string | null;
    market: AssetMarket;
    ok: boolean;
    count: number;
    source?: PriceSource;
    message?: string;
  }>;
  fxResult: {
    ok: boolean;
    count: number;
    message?: string;
  } | null;
};

export type TickerSearchResult = {
  symbol: string;
  name: string;
  exchange: string | null;
  market: AssetMarket;
  currency: string;
};

export type TickerSearchResponse = {
  results: TickerSearchResult[];
};

export type FxRateResponse = {
  rate: number;
  date: string;
};

export type SimulationIncome = {
  id: string;
  accountId: string | null;
  accountName: string | null;
  type: SimulationIncomeType;
  name: string;
  amountKrw: number;
  startDate: string;
  endDate: string | null;
  repeatsIndefinitely: boolean;
  availability: SimulationAvailability;
  unlockDate: string | null;
  note: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SimulationIncomeInput = Omit<SimulationIncome, "id" | "accountName" | "createdAt" | "updatedAt">;

export type DashboardData = {
  date: string;
  accounts: Account[];
  summary: Summary;
  positions: AssetPosition[];
  history: HistoryPoint[];
  transactions: AssetTransaction[];
  syncedAt: string;
  isSnapshot: boolean;
};
