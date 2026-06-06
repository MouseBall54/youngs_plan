import { FormEvent, KeyboardEvent, memo, PointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Banknote,
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Landmark,
  Layers,
  LineChart,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Target,
  Trash2,
  TrendingUp,
  WalletCards,
  X
} from "lucide-react";
import {
  createAccount,
  createAsset,
  createSimulationIncome,
  createTransaction,
  deleteAccount,
  deleteAsset,
  deleteSimulationIncome,
  deleteTransaction,
  fetchDashboard,
  fetchDashboardSnapshot,
  fetchSimulationIncomes,
  fetchUsdKrwRate,
  refreshPriceHistory,
  refreshPrices,
  searchTickers,
  updateAccount,
  updateAsset,
  updateSimulationIncome,
  updateTransaction
} from "./api";
import {
  assetSaleRestrictionFormState,
  hasSaleRestrictionFormChanged,
  liquidFromForSaleRestrictionForm,
  liquidFromForSaleRestrictionLot
} from "./assetFormState";
import { groupedDividendIncomeRows, groupedUnrealizedGainRows } from "./metricDetailGroups";
import { groupSimulationPointsByMonth, simulationAssetAvailability, simulationAssetState } from "./simulation";
import type {
  Account,
  AssetPosition,
  AssetTransaction,
  AssetMarket,
  AssetType,
  AssetValuation,
  BreakdownItem,
  DashboardData,
  HistoryPoint,
  PriceSource,
  SimulationAvailability,
  SimulationIncome,
  SimulationIncomeInput,
  SimulationIncomeType,
  Summary,
  TickerSearchResult,
  TransactionType
} from "./types";

const assetLabels: Record<AssetType, string> = {
  stock: "주식",
  real_estate: "부동산",
  cash: "현금",
  bond: "채권",
  dividend: "배당주"
};

const marketLabels: Record<AssetMarket, string> = {
  domestic: "국내",
  us: "미국",
  other: "기타"
};

const rangeLabels: Record<string, string> = {
  "1w": "1주",
  "1m": "1개월",
  "3m": "3개월",
  "6m": "6개월",
  "1y": "1년",
  all: "전체"
};

const historyCacheKey = (date: string, range: string) => `${date}:${range}`;
const dashboardStorageKey = "youngs-plan-dashboard";
const dashboardStorageVersion = 2;
const dashboardStorageHistoryRange = "1y";
const dashboardStorageTransactionLimit = 200;
const transactionListPageSize = 40;

const transactionLabels: Record<TransactionType, string> = {
  buy: "매수",
  sell: "매도",
  dividend: "배당",
  maturity: "만기",
  deposit: "입금"
};

const priceSourceLabels: Record<PriceSource, string> = {
  manual: "수동 입력",
  yahoo: "Yahoo 시세",
  stooq: "Stooq 시세"
};

const allocationColors = ["#17456b", "#28715b", "#b86b3c", "#6d5bd0", "#9a4d57", "#5d7180"];

const editableTransactionLabels: Record<TransactionMode, string> = {
  buy: "매수",
  sell: "매도",
  dividend: "배당"
};

const today = localDateString();

type Tab = "overview" | "insights" | "assets" | "simulation" | "accounts";
type TransactionMode = "buy" | "sell" | "dividend";
type SimulationRange = "6m" | "1y" | "3y" | "custom";

type SimulationIncomeForm = {
  accountId: string;
  name: string;
  amount: string;
  startDate: string;
  endDate: string;
  repeatsIndefinitely: boolean;
  availability: SimulationAvailability;
  unlockDate: string;
  note: string;
};

type AccountForm = {
  name: string;
  institution: string;
  liquidityRestricted: boolean;
  liquidityUnlockDate: string;
  liquidityRestrictionReason: string;
};

type SimulationIncomeEvent = {
  id: string;
  name: string;
  date: string;
  amountKrw: number;
  accountName: string | null;
  availableFrom: string | null;
  blockReason: "account" | "asset";
};

type SimulationAssetRow = {
  id: string;
  groupKey: string;
  accountId: string;
  name: string;
  accountName: string;
  valueKrw: number;
  availableFrom: string | null;
  blockReason: "asset" | "account" | "unavailable";
  restrictionText: string;
  state: "liquid" | "scheduled" | "unavailable";
};

type SimulationLockedItem = {
  key: string;
  id: string;
  name: string;
  accountName: string | null;
  amountKrw: number;
  availableFrom: string | null;
  reason: "account" | "asset";
};

type SimulationPointDetail = {
  newIncomes: SimulationIncomeEvent[];
  releasedAssets: SimulationAssetRow[];
  releasedIncomes: SimulationIncomeEvent[];
  accountLockedItems: SimulationLockedItem[];
  assetLockedItems: SimulationLockedItem[];
};

type SimulationPoint = {
  date: string;
  periodStartDate?: string;
  periodEndDate?: string;
  totalValueKrw: number;
  liquidValueKrw: number;
  lockedValueKrw: number;
  accountLockedValueKrw: number;
  assetLockedValueKrw: number;
  cumulativeIncomeKrw: number;
  incomeKrw: number;
  detail: SimulationPointDetail;
};

type SimulationResult = {
  points: SimulationPoint[];
  finalPoint: SimulationPoint;
  startingAssetsKrw: number;
  cumulativeIncomeKrw: number;
  assetRows: SimulationAssetRow[];
};

type DashboardIncomePeriodRow = {
  label: string;
  date: string | null;
  valueKrw: number | null;
  deltaKrw: number | null;
  rate: number | null;
};

type DashboardLoadOptions = {
  refreshLatest?: boolean;
  allowCachedData?: boolean;
  showFeedback?: boolean;
};

type DashboardStorageEnvelope = {
  version?: number;
  savedAt?: string;
  data: DashboardData;
};

type MetricDetailFormat = "money" | "signed";

type MetricDetailRow = {
  id: string;
  label: string;
  meta: string;
  amountKrw: number;
  rateText?: string;
  tone?: "neutral" | "positive" | "negative" | "warning";
};

type MetricDetail = {
  key: string;
  title: string;
  totalKrw: number;
  basisDate: string;
  format: MetricDetailFormat;
  rows: MetricDetailRow[];
  emptyText: string;
  note?: string;
  groupRowsByTone?: boolean;
};

type AssetForm = {
  accountId: string;
  type: AssetType;
  name: string;
  market: AssetMarket;
  ticker: string;
  currency: string;
  quantity: string;
  averageCost: string;
  currentValue: string;
  valuationDate: string;
  purchaseFxRateToKrw: string;
  fxRateToKrw: string;
  isSaleRestricted: boolean;
  liquidFrom: string;
  maturityDate: string;
  maturityAmount: string;
  maturityCurrency: string;
  maturityFxRateToKrw: string;
  autoConvertOnMaturity: boolean;
  maturedAt: string | null;
  notes: string;
  assetId: string;
  positionKey: string;
};

const emptyAssetForm: AssetForm = {
  accountId: "",
  type: "stock",
  name: "",
  market: "domestic",
  ticker: "",
  currency: "KRW",
  quantity: "",
  averageCost: "",
  currentValue: "",
  valuationDate: today,
  purchaseFxRateToKrw: "1",
  fxRateToKrw: "1",
  isSaleRestricted: false,
  liquidFrom: today,
  maturityDate: "",
  maturityAmount: "",
  maturityCurrency: "KRW",
  maturityFxRateToKrw: "1",
  autoConvertOnMaturity: true,
  maturedAt: null,
  notes: "",
  assetId: "",
  positionKey: ""
};

const simulationRangeLabels: Record<SimulationRange, string> = {
  "6m": "6개월",
  "1y": "1년",
  "3y": "3년",
  custom: "직접"
};

const emptyMonthlyIncomeForm = (): SimulationIncomeForm => ({
  accountId: "",
  name: "",
  amount: "",
  startDate: today,
  endDate: "",
  repeatsIndefinitely: true,
  availability: "immediate",
  unlockDate: "",
  note: ""
});

const emptyOneTimeIncomeForm = (): SimulationIncomeForm => ({
  accountId: "",
  name: "",
  amount: "",
  startDate: today,
  endDate: "",
  repeatsIndefinitely: false,
  availability: "immediate",
  unlockDate: "",
  note: ""
});

const emptyAccountForm = (): AccountForm => ({
  name: "",
  institution: "",
  liquidityRestricted: false,
  liquidityUnlockDate: "",
  liquidityRestrictionReason: ""
});

export function App() {
  const [initialDashboard] = useState(() => readDashboardStorage(today));
  const [tab, setTab] = useState<Tab>("overview");
  const [accounts, setAccounts] = useState<Account[]>(() => initialDashboard?.accounts ?? []);
  const [summary, setSummary] = useState<Summary | null>(() => initialDashboard?.summary ?? null);
  const [positions, setPositions] = useState<AssetPosition[]>(() => initialDashboard?.positions ?? []);
  const [history, setHistory] = useState<HistoryPoint[]>(() =>
    initialDashboard ? historyPointsForRange(initialDashboard.history, initialDashboard.date, "1m") : []
  );
  const [comparisonHistory, setComparisonHistory] = useState<HistoryPoint[]>(() => initialDashboard?.history ?? []);
  const [transactions, setTransactions] = useState<AssetTransaction[]>(() => initialDashboard?.transactions ?? []);
  const [targetDate, setTargetDate] = useState(today);
  const [range, setRange] = useState("1m");
  const [trendView, setTrendView] = useState("chart");
  const [isHistoryUpdating, setIsHistoryUpdating] = useState(() => !initialDashboard);
  const [status, setStatus] = useState("");
  const [feedback, setFeedback] = useState("");
  const [dashboardSyncedAt, setDashboardSyncedAt] = useState<string | null>(() => initialDashboard?.syncedAt ?? null);
  const [isUsingSnapshot, setIsUsingSnapshot] = useState(() => Boolean(initialDashboard));
  const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isSavingAsset, setIsSavingAsset] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [isRefreshingHistoryPrices, setIsRefreshingHistoryPrices] = useState(false);
  const [isSearchingTickers, setIsSearchingTickers] = useState(false);
  const [isLoadingFx, setIsLoadingFx] = useState(false);
  const [transactionMode, setTransactionMode] = useState<TransactionMode>("buy");
  const [showKrwForUsd, setShowKrwForUsd] = useState(false);
  const [isTradePanelOpen, setIsTradePanelOpen] = useState(false);
  const [assetSearchInput, setAssetSearchInput] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [assetAccountFilter, setAssetAccountFilter] = useState("all");
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetType | "all">("all");
  const [simulationRange, setSimulationRange] = useState<SimulationRange>(() => readSimulationStorage().range);
  const [simulationEndDate, setSimulationEndDate] = useState(() => readSimulationStorage().endDate);
  const [simulationIncomes, setSimulationIncomes] = useState<SimulationIncome[]>(() => readSimulationStorage().incomes);
  const [monthlyIncomeForm, setMonthlyIncomeForm] = useState<SimulationIncomeForm>(() => emptyMonthlyIncomeForm());
  const [oneTimeIncomeForm, setOneTimeIncomeForm] = useState<SimulationIncomeForm>(() => emptyOneTimeIncomeForm());
  const [editingSimulationIncomeId, setEditingSimulationIncomeId] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editingAssetLotIds, setEditingAssetLotIds] = useState<string[]>([]);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [tradePanelFocusRequest, setTradePanelFocusRequest] = useState(0);
  const [activeOverviewMetric, setActiveOverviewMetric] = useState<string | null>(null);
  const [tickerResults, setTickerResults] = useState<TickerSearchResult[]>([]);
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm());
  const [assetForm, setAssetForm] = useState<AssetForm>(emptyAssetForm);
  const tradePanelRef = useRef<HTMLElement | null>(null);
  const historyCacheRef = useRef(
    new Map<string, HistoryPoint[]>(
      initialDashboard
        ? [
            [historyCacheKey(initialDashboard.date, "all"), initialDashboard.history],
            [historyCacheKey(initialDashboard.date, "1m"), historyPointsForRange(initialDashboard.history, initialDashboard.date, "1m")]
          ]
        : []
    )
  );
  const activeHistoryKeyRef = useRef(historyCacheKey(today, "1m"));
  const fullHistoryRef = useRef<HistoryPoint[]>(initialDashboard?.history ?? []);
  const fullHistoryDateRef = useRef(initialDashboard?.date ?? today);
  const isFullHistoryLoadedRef = useRef(Boolean(initialDashboard));
  const historyRequestIdRef = useRef(0);
  const isPriceRefreshInFlightRef = useRef(false);

  useEffect(() => {
    if (!feedback) return;

    const timer = window.setTimeout(() => setFeedback(""), 3500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!status) return;

    const timer = window.setTimeout(() => setStatus(""), 8000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!tradePanelFocusRequest || tab !== "assets" || !isTradePanelOpen) return;

    const frame = window.requestAnimationFrame(() => {
      const panel = tradePanelRef.current;
      if (!panel) return;

      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      const focusTarget =
        panel.querySelector<HTMLElement>(".assetForm input:not([disabled]), .assetForm select:not([disabled]), .assetForm textarea:not([disabled])") ??
        panel.querySelector<HTMLElement>(".assetForm button:not([disabled])");
      focusTarget?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isTradePanelOpen, tab, tradePanelFocusRequest]);

  function requestTradePanelFocus() {
    setTradePanelFocusRequest((request) => request + 1);
  }

  function toggleOverviewMetric(metricKey: string) {
    setActiveOverviewMetric((current) => (current === metricKey ? null : metricKey));
  }

  async function load(preferredAccountId?: string, options: DashboardLoadOptions = {}) {
    const { refreshLatest = false, allowCachedData = true, showFeedback = false } = options;
    const requestedDate = targetDate;
    const requestedRange = range;
    const requestedHistoryKey = historyCacheKey(requestedDate, requestedRange);
    const requestId = ++historyRequestIdRef.current;
    const displayedDateBeforeLoad = summary?.date ?? null;
    const isShowingDifferentDateBeforeLoad = displayedDateBeforeLoad !== null && displayedDateBeforeLoad !== requestedDate;
    let retainedDataAvailable = summary !== null;
    let requestedDataApplied = false;
    let latestRequested = false;

    try {
      setStatus(
        isShowingDifferentDateBeforeLoad
          ? `${formatDisplayDate(requestedDate)} 데이터를 불러오는 중입니다. 현재 화면은 ${formatDisplayDate(
              displayedDateBeforeLoad ?? requestedDate
            )} 저장 데이터입니다.`
          : ""
      );
      if (showFeedback) {
        setFeedback("데이터 새로고침 중입니다.");
      }
      if (refreshLatest) {
        setIsRefreshingDashboard(true);
      }
      setIsHistoryUpdating(true);
      if (!retainedDataAvailable || fullHistoryDateRef.current !== requestedDate) {
        historyCacheRef.current.clear();
        fullHistoryRef.current = [];
        isFullHistoryLoadedRef.current = false;
      }
      activeHistoryKeyRef.current = requestedHistoryKey;

      if (allowCachedData) {
        const cached = readDashboardStorage(requestedDate);
        if (cached) {
          requestedDataApplied = applyDashboardData(cached, preferredAccountId, requestedDate, requestId);
          retainedDataAvailable = requestedDataApplied || retainedDataAvailable;
          if (requestedDataApplied) {
            setStatus("");
            setIsHistoryUpdating(false);
          }
        }

        const snapshot = await fetchDashboardSnapshot(requestedDate).catch(() => null);
        if (snapshot) {
          requestedDataApplied = applyDashboardData(snapshot, preferredAccountId, requestedDate, requestId) || requestedDataApplied;
          retainedDataAvailable = requestedDataApplied || retainedDataAvailable;
          if (requestedDataApplied) {
            setStatus("");
            setIsHistoryUpdating(false);
          }
        }
      }

      if (historyRequestIdRef.current !== requestId || !activeHistoryKeyRef.current.startsWith(`${requestedDate}:`)) {
        return;
      }

      if (!refreshLatest && requestedDataApplied) {
        return;
      }

      latestRequested = true;
      if (!retainedDataAvailable) {
        setStatus("저장된 데이터가 없어 최신 데이터를 불러오는 중입니다.");
      }
      const latestData = await fetchDashboard(requestedDate);
      const latestApplied = applyDashboardData(latestData, preferredAccountId, requestedDate, requestId);
      if (latestApplied) {
        setStatus("");
        if (showFeedback) {
          setFeedback("데이터 새로고침 완료");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.";
      setStatus(
        isShowingDifferentDateBeforeLoad && !requestedDataApplied
          ? `${formatDisplayDate(requestedDate)} 데이터를 불러오지 못했습니다: ${message}. 현재는 ${formatDisplayDate(
              displayedDateBeforeLoad ?? requestedDate
            )} 데이터를 표시 중입니다.`
          : retainedDataAvailable
            ? `최신 데이터 갱신 실패: ${message}`
            : message
      );
    } finally {
      if (historyRequestIdRef.current === requestId && activeHistoryKeyRef.current.startsWith(`${requestedDate}:`)) {
        setIsHistoryUpdating(false);
      }
      if ((latestRequested || refreshLatest) && historyRequestIdRef.current === requestId) {
        setIsRefreshingDashboard(false);
      }
    }
  }

  function applyDashboardData(data: DashboardData, preferredAccountId: string | undefined, requestedDate: string, requestId: number) {
    if (historyRequestIdRef.current !== requestId || !activeHistoryKeyRef.current.startsWith(`${requestedDate}:`)) {
      return false;
    }

    historyCacheRef.current.clear();
    fullHistoryRef.current = data.history;
    fullHistoryDateRef.current = data.date;
    isFullHistoryLoadedRef.current = true;
    historyCacheRef.current.set(historyCacheKey(data.date, "all"), data.history);
    setAccounts(data.accounts);
    setSummary(data.summary);
    setPositions(data.positions);
    const activeRange = activeHistoryKeyRef.current.slice(data.date.length + 1);
    setHistory(historyForRange(data.date, activeRange, data.history));
    setComparisonHistory(data.history);
    setTransactions(data.transactions);
    setDashboardSyncedAt(data.syncedAt);
    setIsUsingSnapshot(data.isSnapshot);
    setAssetForm((current) => ({
      ...current,
      accountId: preferredAccountId ?? current.accountId
    }));
    writeDashboardStorage(data);
    return true;
  }

  useEffect(() => {
    void load();
  }, [targetDate]);

  function historyForRange(date: string, nextRange: string, sourceHistory: HistoryPoint[]) {
    const key = historyCacheKey(date, nextRange);
    const cachedHistory = historyCacheRef.current.get(key);
    if (cachedHistory) return cachedHistory;

    const nextHistory = historyPointsForRange(sourceHistory, date, nextRange);
    historyCacheRef.current.set(key, nextHistory);
    return nextHistory;
  }

  function showHistoryRange(nextRange: string) {
    activeHistoryKeyRef.current = historyCacheKey(targetDate, nextRange);
    if (fullHistoryDateRef.current !== targetDate || !isFullHistoryLoadedRef.current) {
      setIsHistoryUpdating(true);
      return;
    }

    setHistory(historyForRange(targetDate, nextRange, fullHistoryRef.current));
    setIsHistoryUpdating(false);
  }

  function changeRange(nextRange: string) {
    if (nextRange === range) return;
    setRange(nextRange);
    showHistoryRange(nextRange);
  }

  function changeTargetDate(nextDate: string) {
    activeHistoryKeyRef.current = historyCacheKey(nextDate, range);
    setIsHistoryUpdating(true);
    setTargetDate(nextDate);
  }

  useEffect(() => {
    if (transactionMode !== "buy" || tab !== "assets" || assetForm.name.trim().length < 2) {
      setTickerResults([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void searchTickerCandidates();
    }, 650);

    return () => window.clearTimeout(timer);
  }, [assetForm.name, assetForm.market, assetForm.type, tab, transactionMode]);

  useEffect(() => {
    if (transactionMode !== "buy" || tab !== "assets" || assetForm.market !== "us" || assetForm.currency !== "USD") {
      return;
    }

    const timer = window.setTimeout(() => {
      void syncUsdRates();
    }, 350);

    return () => window.clearTimeout(timer);
  }, [assetForm.market, assetForm.currency, assetForm.valuationDate, tab, transactionMode]);

  useEffect(() => {
    if (
      transactionMode !== "sell" ||
      tab !== "assets" ||
      !assetForm.positionKey ||
      assetForm.market !== "us" ||
      assetForm.currency !== "USD"
    ) {
      return;
    }

    let cancelled = false;
    const transactionDate = assetForm.valuationDate;
    const positionKey = assetForm.positionKey;
    const timer = window.setTimeout(() => {
      setIsLoadingFx(true);
      fetchUsdKrwRate(transactionDate)
        .then((rate) => {
          if (cancelled) return;
          setAssetForm((current) => {
            if (
              current.positionKey !== positionKey ||
              current.valuationDate !== transactionDate ||
              current.market !== "us" ||
              current.currency !== "USD"
            ) {
              return current;
            }

            return {
              ...current,
              fxRateToKrw: Math.round(rate.rate * 100) / 100 + ""
            };
          });
        })
        .catch((error) => {
          if (!cancelled) setStatus(error instanceof Error ? error.message : "매도일 환율을 불러오지 못했습니다.");
        })
        .finally(() => {
          if (!cancelled) setIsLoadingFx(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assetForm.positionKey, assetForm.market, assetForm.currency, assetForm.valuationDate, tab, transactionMode]);

  const tickerAssets = useMemo(() => summary?.assets.filter((asset) => asset.ticker) ?? [], [summary]);
  const displayedAssets = useMemo(() => aggregateAssetRows(summary?.assets ?? []), [summary]);
  const filteredAssets = useMemo(
    () => filterAssetRows(displayedAssets, assetSearch, assetAccountFilter, assetTypeFilter),
    [displayedAssets, assetSearch, assetAccountFilter, assetTypeFilter]
  );
  const problemAssets = useMemo(() => displayedAssets.filter((asset) => asset.lastPriceError), [displayedAssets]);
  const liquidityRatio = summary?.liquidRatio ?? 0;
  const lockedRatio = Math.max(0, 100 - liquidityRatio);
  const simulationResult = useMemo(
    () => buildSimulation(summary?.assets ?? [], simulationIncomes, accounts, today, simulationEndDate),
    [summary, simulationIncomes, accounts, simulationEndDate]
  );
  const overviewMetricDetails = useMemo(
    () => (summary ? buildSummaryMetricDetails(summary, transactions, targetDate) : new Map<string, MetricDetail>()),
    [summary, transactions, targetDate]
  );
  const activeOverviewDetail = activeOverviewMetric ? overviewMetricDetails.get(activeOverviewMetric) ?? null : null;
  const displayedDashboardDate = summary?.date ?? null;
  const isShowingDifferentDate = displayedDashboardDate !== null && displayedDashboardDate !== targetDate;

  useEffect(() => {
    writeSimulationStorage({
      range: simulationRange,
      endDate: simulationEndDate,
      incomes: simulationIncomes
    });
  }, [simulationRange, simulationEndDate, simulationIncomes]);

  useEffect(() => {
    void loadSimulationIncomes();
  }, []);

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    if (!accountForm.name.trim()) {
      setFeedback("");
      setStatus("계좌명을 입력해 주세요.");
      return;
    }
    if (accountForm.liquidityRestricted && !accountForm.liquidityUnlockDate) {
      setFeedback("");
      setStatus("현금화 제한 계좌는 해지 가능일을 입력해 주세요.");
      return;
    }

    try {
      setFeedback("");
      setStatus("");
      setIsSavingAccount(true);
      const accountInput = accountInputFromForm(accountForm);
      const account = editingAccountId
        ? await updateAccount(editingAccountId, accountInput)
        : await createAccount(accountInput);
      setEditingAccountId(null);
      setAccountForm(emptyAccountForm());
      setFeedback(`계좌 "${account.name}" ${editingAccountId ? "수정" : "등록"} 완료`);
      await load(account.id, { refreshLatest: true, allowCachedData: false });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "계좌를 저장하지 못했습니다.");
    } finally {
      setIsSavingAccount(false);
    }
  }

  async function submitAsset(event: FormEvent) {
    event.preventDefault();
    const targetMessage = targetSelectionMessage(transactionMode, assetForm);
    if (targetMessage) {
      setFeedback("");
      setStatus(targetMessage);
      return;
    }

    try {
      setFeedback("");
      setStatus("");
      setIsSavingAsset(true);
      const transactionPayload =
        transactionMode === "buy"
          ? buyTransactionPayload(assetForm)
          : transactionMode === "sell"
            ? sellTransactionPayload(assetForm)
            : dividendTransactionPayload(assetForm);

      if (editingTransactionId) {
        await updateTransaction(editingTransactionId, transactionPayload);
      } else if (editingAssetId && transactionMode === "buy") {
        if (editingAssetLotIds.length > 1) {
          await updateAggregateAssetLinkage();
        } else {
          const payload = assetPayload(assetForm);
          await updateAsset(editingAssetId, payload);
        }
      } else if (transactionMode === "buy") {
        await createTransaction(transactionPayload);
      } else if (transactionMode === "sell") {
        await createTransaction(transactionPayload);
      } else {
        await createTransaction(transactionPayload);
      }
      setAssetForm(emptyAssetForm);
      setEditingAssetId(null);
      setEditingAssetLotIds([]);
      setEditingTransactionId(null);
      setIsTradePanelOpen(false);
      setFeedback(`${transactionLabels[transactionMode]} ${editingAssetId || editingTransactionId ? "수정" : "등록"} 완료`);
      await load(undefined, { refreshLatest: true, allowCachedData: false });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "자산을 저장하지 못했습니다.");
    } finally {
      setIsSavingAsset(false);
    }
  }

  async function removeAsset(asset: AssetValuation) {
    if (!window.confirm(`"${asset.name}" 자산을 삭제할까요?`)) return;
    try {
      setStatus("");
      await deleteAsset(asset.id);
      setFeedback(`자산 "${asset.name}" 삭제 완료`);
      await load(undefined, { refreshLatest: true, allowCachedData: false });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "자산을 삭제하지 못했습니다.");
    }
  }

  async function removeAccount(account: Account) {
    if (!window.confirm(`"${account.name}" 계좌와 연결된 자산을 모두 삭제할까요?`)) return;
    try {
      setStatus("");
      await deleteAccount(account.id);
      setFeedback(`계좌 "${account.name}" 삭제 완료`);
      setEditingAccountId(null);
      await load(undefined, { refreshLatest: true, allowCachedData: false });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "계좌를 삭제하지 못했습니다.");
    }
  }

  async function updateTickerPrices() {
    await refreshCurrentPrices({
      requestedDate: targetDate,
      requestId: historyRequestIdRef.current,
      silent: false
    });
  }

  async function refreshCurrentPrices({
    requestedDate,
    requestId,
    preferredAccountId,
    silent
  }: {
    requestedDate: string;
    requestId: number;
    preferredAccountId?: string;
    silent: boolean;
  }) {
    if (isPriceRefreshInFlightRef.current) {
      return;
    }

    isPriceRefreshInFlightRef.current = true;
    try {
      setStatus("");
      if (!silent) {
        setFeedback("현재가 갱신 중입니다.");
      }
      setIsRefreshingPrices(true);
      const result = await refreshPrices();
      const successCount = result.results.filter((item) => item.ok).length;
      const failCount = result.results.length - successCount;
      const failedText = summarizePriceRefreshFailures(result.results);
      if (!silent) {
        setFeedback(`현재가 갱신 완료: 성공 ${successCount}개${failCount ? `, 실패 ${failCount}개${failedText}` : ""}`);
      }
      if (successCount > 0) {
        const refreshedDashboard = await fetchDashboard(requestedDate);
        applyDashboardData(refreshedDashboard, preferredAccountId, requestedDate, requestId);
      }
    } catch (error) {
      if (!silent) {
        setStatus(error instanceof Error ? error.message : "현재가를 갱신하지 못했습니다.");
        return;
      }
      throw error;
    } finally {
      isPriceRefreshInFlightRef.current = false;
      setIsRefreshingPrices(false);
    }
  }

  async function updateHistoricalPrices() {
    const startDate = history[0]?.date ?? shiftDate(targetDate, -364);
    try {
      setStatus("");
      setFeedback(`과거 일별 시세 저장 중입니다. (${startDate} ~ ${targetDate})`);
      setIsRefreshingHistoryPrices(true);
      const result = await refreshPriceHistory(startDate, targetDate);
      const successCount = result.results.filter((item) => item.ok).length;
      const failCount = result.results.length - successCount + (result.fxResult && !result.fxResult.ok ? 1 : 0);
      const savedCount = result.results.reduce((sum, item) => sum + item.count, 0) + (result.fxResult?.count ?? 0);
      const failedText = summarizePriceHistoryFailures(result.results, result.fxResult);
      setFeedback(`과거 일별 시세 저장 완료: ${savedCount}건${failCount ? `, 실패 ${failCount}개${failedText}` : ""}`);
      await load(undefined, { refreshLatest: true, allowCachedData: false });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "과거 일별 시세를 저장하지 못했습니다.");
    } finally {
      setIsRefreshingHistoryPrices(false);
    }
  }

  async function searchTickerCandidates() {
    if (assetForm.name.trim().length < 2) {
      setTickerResults([]);
      return;
    }

    try {
      setIsSearchingTickers(true);
      const result = await searchTickers(assetForm.name, assetForm.market);
      setTickerResults(result.results);
    } catch (error) {
      setTickerResults([]);
      setStatus(error instanceof Error ? error.message : "티커를 검색하지 못했습니다.");
    } finally {
      setIsSearchingTickers(false);
    }
  }

  function selectTicker(ticker: TickerSearchResult) {
    setAssetForm((current) => ({
      ...current,
      ticker: ticker.symbol,
      name: current.name || ticker.name,
      market: ticker.market,
      currency: ticker.currency,
      maturityCurrency: current.type === "bond" ? ticker.currency : current.maturityCurrency,
      purchaseFxRateToKrw: ticker.currency === "KRW" ? "1" : current.purchaseFxRateToKrw,
      fxRateToKrw: ticker.currency === "KRW" ? "1" : current.fxRateToKrw,
      maturityFxRateToKrw: ticker.currency === "KRW" ? "1" : current.maturityFxRateToKrw
    }));
    setTickerResults([]);
  }

  async function syncUsdRates() {
    try {
      setIsLoadingFx(true);
      const [purchaseRate, currentRate] = await Promise.all([fetchUsdKrwRate(assetForm.valuationDate), fetchUsdKrwRate()]);
      setAssetForm((current) => {
        if (current.market !== "us" || current.currency !== "USD") {
          return current;
        }

        return {
          ...current,
          purchaseFxRateToKrw: Math.round(purchaseRate.rate * 100) / 100 + "",
          fxRateToKrw: Math.round(currentRate.rate * 100) / 100 + "",
          maturityFxRateToKrw: current.type === "bond" ? Math.round(currentRate.rate * 100) / 100 + "" : current.maturityFxRateToKrw
        };
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "환율을 불러오지 못했습니다.");
    } finally {
      setIsLoadingFx(false);
    }
  }

  function startAssetEdit(asset: AssetValuation) {
    const lotIds = asset.lotIds ?? [asset.id];
    const lots = (summary?.assets ?? []).filter((item) => lotIds.includes(item.id));
    setEditingAssetId(asset.id);
    setEditingAssetLotIds(lotIds);
    setEditingTransactionId(null);
    setAssetForm(formFromAsset(asset, lots.length > 0 ? lots : [asset]));
    setIsTradePanelOpen(true);
    setTab("assets");
    requestTradePanelFocus();
  }

  async function updateAggregateAssetLinkage() {
    const lots = (summary?.assets ?? []).filter((asset) => editingAssetLotIds.includes(asset.id));
    if (lots.length !== editingAssetLotIds.length) {
      throw new Error("합산 자산의 개별 lot 정보를 찾지 못했습니다.");
    }

    const updateSaleRestriction = hasSaleRestrictionFormChanged(lots, assetForm);

    await Promise.all(lots.map((asset) => updateAsset(asset.id, assetLinkagePayload(asset, assetForm, updateSaleRestriction))));
  }

  function startTransactionEdit(transaction: AssetTransaction) {
    if (transaction.transactionType === "maturity") {
      setStatus("만기 상환 거래는 삭제로 되돌린 뒤 채권 정보를 수정할 수 있습니다.");
      return;
    }
    if (transaction.transactionType === "deposit") {
      setStatus("입금 거래는 파일 거래내역 표시용으로 등록되어 수정할 수 없습니다.");
      return;
    }
    setEditingAssetId(null);
    setEditingAssetLotIds([]);
    setEditingTransactionId(transaction.id);
    setTransactionMode(transaction.transactionType);
    setAssetForm(formFromTransaction(transaction, positions, accounts, summary?.assets ?? []));
    setTickerResults([]);
    setIsTradePanelOpen(true);
    setTab("assets");
    requestTradePanelFocus();
  }

  async function removeTransaction(transaction: AssetTransaction) {
    const message = isZeroQuantityTrade(transaction)
      ? `${transactionLabels[transaction.transactionType]} 0주 거래를 삭제할까요? 삭제 후 요약과 자산 데이터를 다시 불러옵니다.`
      : `${transactionLabels[transaction.transactionType]} 거래를 삭제할까요?`;
    if (!window.confirm(message)) return;
    try {
      setStatus("");
      await deleteTransaction(transaction.id);
      if (editingTransactionId === transaction.id) {
        setEditingTransactionId(null);
        setAssetForm(emptyAssetForm);
      }
      setFeedback("거래 삭제 완료");
      await load(undefined, { refreshLatest: true, allowCachedData: false });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "거래를 삭제하지 못했습니다.");
    }
  }

  function startAccountEdit(account: Account) {
    setEditingAccountId(account.id);
    setAccountForm({
      name: account.name,
      institution: account.institution ?? "",
      liquidityRestricted: account.liquidityRestricted,
      liquidityUnlockDate: account.liquidityUnlockDate ?? "",
      liquidityRestrictionReason: account.liquidityRestrictionReason ?? ""
    });
    setTab("accounts");
  }

  function resetAssetForm() {
    setEditingAssetId(null);
    setEditingAssetLotIds([]);
    setEditingTransactionId(null);
    setAssetForm(emptyAssetForm);
  }

  function openNewTrade(mode: TransactionMode = "buy") {
    setTransactionMode(mode);
    setEditingAssetId(null);
    setEditingAssetLotIds([]);
    setEditingTransactionId(null);
    setAssetForm(emptyAssetForm);
    setTickerResults([]);
    setIsTradePanelOpen(true);
  }

  function resetAccountForm() {
    setEditingAccountId(null);
    setAccountForm(emptyAccountForm());
  }

  function changeSimulationRange(nextRange: string) {
    const parsedRange = nextRange as SimulationRange;
    setSimulationRange(parsedRange);
    if (parsedRange !== "custom") {
      setSimulationEndDate(simulationEndDateForRange(parsedRange, today));
    }
  }

  async function loadSimulationIncomes() {
    try {
      const stored = readSimulationStorage().incomes;
      const dbIncomes = await fetchSimulationIncomes();
      if (dbIncomes.length > 0) {
        setSimulationIncomes(dbIncomes);
        return;
      }

      if (stored.length === 0) {
        setSimulationIncomes([]);
        return;
      }

      const migrated: SimulationIncome[] = [];
      for (const income of stored) {
        migrated.push(await createSimulationIncome(simulationIncomeInputFromIncome(income)));
      }
      setSimulationIncomes(migrated);
      setFeedback("기존 시뮬레이션 입력값을 DB로 옮겼습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "시뮬레이션 입력값을 불러오지 못했습니다.");
    }
  }

  async function addSimulationIncome(type: SimulationIncomeType, event: FormEvent) {
    event.preventDefault();
    const form = type === "monthly" ? monthlyIncomeForm : oneTimeIncomeForm;
    const editingIncome = editingSimulationIncomeId
      ? simulationIncomes.find((income) => income.id === editingSimulationIncomeId) ?? null
      : null;
    const amountKrw = Number(form.amount);

    if (!form.name.trim()) {
      setStatus("예상 수입 이름을 입력해 주세요.");
      return;
    }

    if (!Number.isFinite(amountKrw) || amountKrw <= 0) {
      setStatus("예상 수입 금액을 0원보다 크게 입력해 주세요.");
      return;
    }

    if (!form.startDate) {
      setStatus(type === "monthly" ? "월 수입 시작일을 입력해 주세요." : "입금 예정일을 입력해 주세요.");
      return;
    }

    if (type === "monthly" && !form.repeatsIndefinitely) {
      if (!form.endDate) {
        setStatus("월 수입 종료일을 입력하거나 계속 반복을 켜 주세요.");
        return;
      }

      if (form.endDate < form.startDate) {
        setStatus("월 수입 종료일은 시작일 이후여야 합니다.");
        return;
      }
    }

    if (form.availability === "unlock_date" && !form.unlockDate) {
      setStatus("제한 해제일을 입력해 주세요.");
      return;
    }

    setStatus("");
    setFeedback("");
    try {
      const input = simulationIncomeInputFromForm(type, form, Math.round(amountKrw));
      const savedIncome = editingIncome
        ? await updateSimulationIncome(editingIncome.id, input)
        : await createSimulationIncome(input);
      setSimulationIncomes((current) =>
        editingIncome
          ? current.map((income) => (income.id === editingIncome.id ? savedIncome : income))
          : [...current, savedIncome]
      );
      if (type === "monthly") {
        setMonthlyIncomeForm(emptyMonthlyIncomeForm());
      } else {
        setOneTimeIncomeForm(emptyOneTimeIncomeForm());
      }
      setEditingSimulationIncomeId(null);
      setFeedback(editingIncome ? "시뮬레이션 수입 수정 완료" : "시뮬레이션 수입 추가 완료");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "시뮬레이션 수입을 저장하지 못했습니다.");
    }
  }

  async function removeSimulationIncome(id: string) {
    const income = simulationIncomes.find((item) => item.id === id) ?? null;
    if (typeof window !== "undefined" && income && !window.confirm(`${income.name} 입력값을 삭제할까요?`)) {
      return;
    }

    try {
      setStatus("");
      await deleteSimulationIncome(id);
      setSimulationIncomes((current) => current.filter((income) => income.id !== id));
      if (editingSimulationIncomeId === id) {
        cancelSimulationIncomeEdit();
      }
      setFeedback("시뮬레이션 수입 삭제 완료");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "시뮬레이션 수입을 삭제하지 못했습니다.");
    }
  }

  function startSimulationIncomeEdit(income: SimulationIncome) {
    setEditingSimulationIncomeId(income.id);
    setStatus("");
    if (income.type === "monthly") {
      setMonthlyIncomeForm(formFromSimulationIncome(income));
    } else {
      setOneTimeIncomeForm(formFromSimulationIncome(income));
    }
  }

  function cancelSimulationIncomeEdit() {
    const editingIncome = editingSimulationIncomeId
      ? simulationIncomes.find((income) => income.id === editingSimulationIncomeId) ?? null
      : null;
    if (editingIncome?.type === "one_time") {
      setOneTimeIncomeForm(emptyOneTimeIncomeForm());
    } else {
      setMonthlyIncomeForm(emptyMonthlyIncomeForm());
    }
    setEditingSimulationIncomeId(null);
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">Young's Plan</p>
          <h1>자산 대시보드</h1>
        </div>
        <button
          className="iconButton headerRefreshButton"
          type="button"
          onClick={() => void load(undefined, { refreshLatest: true, allowCachedData: false, showFeedback: true })}
          disabled={isRefreshingDashboard}
          aria-label="데이터 새로고침"
          title="데이터 새로고침"
        >
          <RefreshCw size={20} />
          <span>{isRefreshingDashboard ? "갱신 중" : "데이터"}</span>
        </button>
      </header>

      <section className="controlBar">
        <label>
          <CalendarDays size={17} />
          <input
            name="targetDate"
            type="date"
            value={targetDate}
            onChange={(event) => changeTargetDate(event.target.value)}
          />
        </label>
        <button
          className="priceRefreshButton"
          type="button"
          onClick={() => void updateTickerPrices()}
          disabled={!tickerAssets.length || isRefreshingPrices}
          title="보유 종목의 현재가를 가져와 오늘 평가액에 반영합니다."
        >
          <RefreshCw size={16} />
          <span>{isRefreshingPrices ? "현재가 갱신 중" : "현재가 갱신"}</span>
        </button>
        <button
          className="priceRefreshButton"
          type="button"
          onClick={() => void updateHistoricalPrices()}
          disabled={!tickerAssets.length || isRefreshingHistoryPrices}
          title="기간별 손익 계산을 위해 과거 일별 주가와 환율을 DB에 저장합니다."
        >
          <RefreshCw size={16} />
          <span>{isRefreshingHistoryPrices ? "일별 시세 저장 중" : "과거 일별 시세 저장"}</span>
        </button>
      </section>

      {status && <Notice message={status} onDismiss={() => setStatus("")} />}
      {feedback && <Notice message={feedback} tone="success" onDismiss={() => setFeedback("")} />}
      {dashboardSyncedAt && (
        <div className={isUsingSnapshot ? "snapshotStatus" : "snapshotStatus live"} role="status">
          <span>
            {isShowingDifferentDate
              ? `${formatDisplayDate(displayedDashboardDate ?? targetDate)} 데이터 표시 중`
              : isUsingSnapshot
                ? "최근 저장 데이터 표시 중"
                : "최신 데이터 표시 중"}
          </span>
          <time dateTime={dashboardSyncedAt}>
            {isShowingDifferentDate
              ? `${formatDisplayDate(targetDate)} 데이터 ${isHistoryUpdating ? "불러오는 중" : "대기 중"} · 마지막 갱신 ${formatDisplayDateTime(
                  dashboardSyncedAt
                )}`
              : `마지막 갱신 ${formatDisplayDateTime(dashboardSyncedAt)}`}
          </time>
        </div>
      )}

      {tab === "overview" && (
        <>
          <section className="heroCard">
            <div className="heroPrimary">
              <span>총 평가액</span>
              <strong>{formatKrw(summary?.totalValueKrw ?? 0)}</strong>
              <p className={gainClass(summary?.totalGainKrw ?? 0)}>
                총수익률 {formatPercent(summary?.totalGainRate)} · {formatSignedKrw(summary?.totalIncomeKrw ?? summary?.totalGainKrw ?? 0)}
              </p>
            </div>
            <div className="heroLiquidity" aria-label="현금화 가능 비율">
              <div>
                <span>현금화 가능</span>
                <b>{formatPercent(liquidityRatio)}</b>
              </div>
              <LiquiditySplitBar liquidRatio={liquidityRatio} />
              <div className="liquidityAmounts">
                <span>{compactKrw(summary?.liquidValueKrw ?? 0)}</span>
                <span>{compactKrw(summary?.lockedValueKrw ?? 0)} 제한</span>
              </div>
              {(summary?.lockedValueKrw ?? 0) > 0 && (
                <div className="liquidityReasonAmounts">
                  <span>계좌 제한 {compactKrw(summary?.accountLockedValueKrw ?? 0)}</span>
                  <span>자산 제한 {compactKrw(summary?.assetLockedValueKrw ?? 0)}</span>
                </div>
              )}
            </div>
          </section>

          <section className="priorityMetrics" aria-label="핵심 자산 지표">
            <Metric
              title="현금화 가능"
              value={compactKrw(summary?.liquidValueKrw ?? 0)}
              detail={`${formatPercent(liquidityRatio)} 즉시 대응 가능`}
              icon={<CircleDollarSign />}
              tone="positive"
              priority="high"
              selected={Boolean(summary && activeOverviewMetric === "liquid")}
              onClick={summary ? () => toggleOverviewMetric("liquid") : undefined}
            />
            <Metric
              title="제한 자산"
              value={compactKrw(summary?.lockedValueKrw ?? 0)}
              detail={`계좌 ${compactKrw(summary?.accountLockedValueKrw ?? 0)} · 자산 ${compactKrw(summary?.assetLockedValueKrw ?? 0)}`}
              icon={<Landmark />}
              tone="warning"
              priority="high"
              selected={Boolean(summary && activeOverviewMetric === "locked")}
              onClick={summary ? () => toggleOverviewMetric("locked") : undefined}
            />
            <Metric
              title="총수익"
              value={compactSignedKrw(summary?.totalIncomeKrw ?? summary?.totalGainKrw ?? 0)}
              detail={`총수익률 ${formatPercent(summary?.totalGainRate)}`}
              icon={<LineChart />}
              tone={(summary?.totalIncomeKrw ?? summary?.totalGainKrw ?? 0) >= 0 ? "positive" : "negative"}
              priority="high"
              selected={Boolean(summary && activeOverviewMetric === "total-income")}
              onClick={summary ? () => toggleOverviewMetric("total-income") : undefined}
            />
          </section>

          <section className="secondaryMetrics" aria-label="보조 자산 지표">
            <Metric title="원금" value={compactKrw(summary?.totalCostKrw ?? 0)} icon={<WalletCards />} />
            <Metric
              title="평가손익"
              value={compactSignedKrw(summary?.unrealizedGainKrw ?? 0)}
              icon={<LineChart />}
              tone={(summary?.unrealizedGainKrw ?? 0) >= 0 ? "positive" : "negative"}
              selected={Boolean(summary && activeOverviewMetric === "unrealized")}
              onClick={summary ? () => toggleOverviewMetric("unrealized") : undefined}
            />
            <Metric
              title="차익실현"
              value={compactSignedKrw(summary?.realizedGainKrw ?? 0)}
              icon={<Banknote />}
              tone={(summary?.realizedGainKrw ?? 0) >= 0 ? "positive" : "negative"}
              selected={Boolean(summary && activeOverviewMetric === "realized")}
              onClick={summary ? () => toggleOverviewMetric("realized") : undefined}
            />
            <Metric
              title="배당수익"
              value={compactSignedKrw(summary?.dividendIncomeKrw ?? 0)}
              icon={<CircleDollarSign />}
              tone="positive"
              selected={Boolean(summary && activeOverviewMetric === "dividend")}
              onClick={summary ? () => toggleOverviewMetric("dividend") : undefined}
            />
          </section>

          {activeOverviewDetail && <MetricDetailPanel detail={activeOverviewDetail} onClose={() => setActiveOverviewMetric(null)} />}

          {problemAssets.length > 0 && (
            <section className="riskPanel" aria-label="확인 필요한 자산">
              <div>
                <AlertTriangle size={18} />
                <strong>확인 필요 {problemAssets.length}개</strong>
              </div>
              <span>{problemAssets.slice(0, 2).map((asset) => asset.name).join(", ")} 시세 업데이트 오류</span>
            </section>
          )}

          <section className="panel analysisPanel">
            <div className="sectionHeader">
              <div>
                <h2>자산 분석</h2>
                <span>비중, 평가액, 수익률</span>
              </div>
            </div>
            <AllocationAnalysis items={summary?.byTypeDetails ?? []} assets={summary?.assets ?? []} labels={assetLabels} />
          </section>

          <section className="panel chartPanel">
            <div className="sectionHeader">
              <div>
                <h2>기간별 추이</h2>
                <span>매도 가능일 기준 현금화 가능/제한 자산</span>
              </div>
              <div className="sectionControls">
                <Segmented options={{ chart: "그래프", table: "테이블" }} value={trendView} onChange={setTrendView} />
                <Segmented options={rangeLabels} value={range} onChange={changeRange} />
              </div>
            </div>
            {trendView === "chart" ? (
              <TimelineChart points={history} isUpdating={isHistoryUpdating} />
            ) : (
              <LiquidityReleaseTable assets={summary?.assets ?? []} points={history} />
            )}
          </section>

          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>계좌 구분</h2>
                <span>계좌별 평가액</span>
              </div>
            </div>
            <AccountBreakdownList items={summary?.byAccountDetails ?? []} assets={summary?.assets ?? []} />
          </section>
        </>
      )}

      {tab === "insights" && (
        <ComparisonDashboardView
          summary={summary}
          history={comparisonHistory}
          transactions={transactions}
          simulationResult={simulationResult}
          targetDate={targetDate}
        />
      )}

      {tab === "assets" && (
        <>
          <section className="assetWorkspace">
            <div className="sectionHeader">
              <div>
                <h2>자산 목록</h2>
                <span>
                  {filteredAssets.length}개
                  {(summary?.assets.length ?? 0) > displayedAssets.length ? ` · 매수 ${summary?.assets.length ?? 0}건` : ""}
                </span>
              </div>
              <button className="primaryActionButton" type="button" onClick={() => openNewTrade("buy")}>
                <Plus size={17} />
                거래 등록
              </button>
            </div>

            <div className="assetToolbar">
              <div className="assetSearchBox">
                <input
                  name="assetSearch"
                  placeholder="자산, 계좌, 티커 검색"
                  value={assetSearchInput}
                  onChange={(event) => {
                    setAssetSearchInput(event.target.value);
                    setAssetSearch(event.target.value);
                  }}
                />
                <Search size={16} />
              </div>
              <select name="assetAccountFilter" value={assetAccountFilter} onChange={(event) => setAssetAccountFilter(event.target.value)}>
                <option value="all">전체 계좌</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              <select
                name="assetTypeFilter"
                value={assetTypeFilter}
                onChange={(event) => setAssetTypeFilter(event.target.value as AssetType | "all")}
              >
                <option value="all">전체 분류</option>
                {Object.entries(assetLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button className="textButton" type="button" onClick={() => setShowKrwForUsd((current) => !current)}>
                {showKrwForUsd ? "달러 보기" : "원/달러 보기"}
              </button>
            </div>
            {isTradePanelOpen && (
              <section className="panel tradeEntryPanel" ref={tradePanelRef}>
                <div className="sectionHeader">
                  <div>
                    <h2>{editingAssetId || editingTransactionId ? "거래 수정" : "거래 등록"}</h2>
                    <span>유형, 대상, 금액, 조건을 확인한 뒤 저장합니다.</span>
                  </div>
                  <button
                    className="textButton"
                    type="button"
                    onClick={() => {
                      resetAssetForm();
                      setIsTradePanelOpen(false);
                    }}
                  >
                    닫기
                  </button>
                </div>
                <AssetFormView
                  accounts={accounts}
                  assets={summary?.assets ?? []}
                  positions={positions}
                  mode={transactionMode}
                  form={assetForm}
                  isSaving={isSavingAsset}
                  isSearchingTickers={isSearchingTickers}
                  isLoadingFx={isLoadingFx}
                  tickerResults={tickerResults}
                  onModeChange={(mode) => {
                    setTransactionMode(mode);
                    setTickerResults([]);
                    setEditingAssetId(null);
                    setEditingAssetLotIds([]);
                    setAssetForm(emptyAssetForm);
                  }}
                  onChange={setAssetForm}
                  onSearchTicker={() => void searchTickerCandidates()}
                  onSelectTicker={selectTicker}
                  isAggregateAssetEdit={editingAssetLotIds.length > 1 && transactionMode === "buy"}
                  onSubmit={submitAsset}
                />
              </section>
            )}
            <AssetList
              assets={filteredAssets}
              showKrwForUsd={showKrwForUsd}
              onEdit={startAssetEdit}
              onDelete={(asset) => void removeAsset(asset)}
            />
          </section>

          <section className="panel transactionPanel">
            <div className="sectionHeader">
              <div>
                <h2>거래 히스토리</h2>
                <span>차익실현과 배당수익이 날짜별로 남습니다.</span>
              </div>
            </div>
            <TransactionList
              transactions={transactions}
              onEdit={startTransactionEdit}
              onDelete={(transaction) => void removeTransaction(transaction)}
            />
          </section>
        </>
      )}

      {tab === "simulation" && (
        <SimulationView
          result={simulationResult}
          incomes={simulationIncomes}
          accounts={accounts}
          editingIncomeId={editingSimulationIncomeId}
          range={simulationRange}
          endDate={simulationEndDate}
          monthlyForm={monthlyIncomeForm}
          oneTimeForm={oneTimeIncomeForm}
          onRangeChange={changeSimulationRange}
          onEndDateChange={(dateValue) => {
            setSimulationRange("custom");
            setSimulationEndDate(dateValue);
          }}
          onMonthlyFormChange={setMonthlyIncomeForm}
          onOneTimeFormChange={setOneTimeIncomeForm}
          onAddMonthlyIncome={(event) => addSimulationIncome("monthly", event)}
          onAddOneTimeIncome={(event) => addSimulationIncome("one_time", event)}
          onCancelIncomeEdit={cancelSimulationIncomeEdit}
          onEditIncome={startSimulationIncomeEdit}
          onRemoveIncome={removeSimulationIncome}
        />
      )}

      {tab === "accounts" && (
        <>
          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>{editingAccountId ? "계좌 수정" : "계좌 등록"}</h2>
                <span>은행, 증권사, 부동산 등 자산을 묶을 단위입니다.</span>
              </div>
              {editingAccountId && (
                <button className="textButton" type="button" onClick={resetAccountForm}>
                  신규 입력
                </button>
              )}
            </div>
            <form className="compactForm" noValidate onSubmit={(event) => void submitAccount(event)}>
              <input
                name="accountName"
                placeholder="계좌명"
                value={accountForm.name}
                onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })}
              />
              <input
                name="institution"
                placeholder="기관"
                value={accountForm.institution}
                onChange={(event) => setAccountForm({ ...accountForm, institution: event.target.value })}
              />
              <label className="toggleRow accountRestrictionToggle">
                <input
                  name="accountLiquidityRestricted"
                  type="checkbox"
                  checked={accountForm.liquidityRestricted}
                  onChange={(event) =>
                    setAccountForm({
                      ...accountForm,
                      liquidityRestricted: event.target.checked,
                      liquidityUnlockDate: event.target.checked ? accountForm.liquidityUnlockDate : ""
                    })
                  }
                />
                <span>현금화 제한</span>
              </label>
              {accountForm.liquidityRestricted && (
                <>
                  <label className="dateInput">
                    해지 가능일
                    <input
                      type="date"
                      value={accountForm.liquidityUnlockDate}
                      onChange={(event) => setAccountForm({ ...accountForm, liquidityUnlockDate: event.target.value })}
                    />
                  </label>
                  <input
                    name="liquidityRestrictionReason"
                    placeholder="제한 사유 예: ISA, 연금"
                    value={accountForm.liquidityRestrictionReason}
                    onChange={(event) => setAccountForm({ ...accountForm, liquidityRestrictionReason: event.target.value })}
                  />
                </>
              )}
              <button type="submit" disabled={isSavingAccount}>
                <Plus size={18} />
                {isSavingAccount ? "저장 중" : editingAccountId ? "수정" : "추가"}
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>계좌 목록</h2>
                <span>{accounts.length}개</span>
              </div>
            </div>
            <div className="accountList">
              {accounts.length === 0 ? (
                <span className="emptyText">등록된 계좌 없음</span>
              ) : (
                accounts.map((account) => (
                  <article className="accountItem" key={account.id}>
                    <div>
                      <strong>{account.name}</strong>
                      <span>{account.institution || "기관 미입력"}</span>
                      {account.liquidityRestricted && (
                        <span className="accountRestrictionBadge">
                          현금화 제한
                          {account.liquidityUnlockDate ? ` · ${account.liquidityUnlockDate} 이후` : ""}
                          {account.liquidityRestrictionReason ? ` · ${account.liquidityRestrictionReason}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="rowActions">
                      <button type="button" onClick={() => startAccountEdit(account)} aria-label={`${account.name} 수정`}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => void removeAccount(account)} aria-label={`${account.name} 삭제`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </>
      )}

      <nav className="bottomNav" aria-label="주요 메뉴">
        <TabButton active={tab === "overview"} icon={<BarChart3 />} label="요약" onClick={() => setTab("overview")} />
        <TabButton active={tab === "insights"} icon={<Target />} label="인사이트" onClick={() => setTab("insights")} />
        <TabButton active={tab === "assets"} icon={<LineChart />} label="자산" onClick={() => setTab("assets")} />
        <TabButton active={tab === "simulation"} icon={<CircleDollarSign />} label="시뮬레이션" onClick={() => setTab("simulation")} />
        <TabButton active={tab === "accounts"} icon={<WalletCards />} label="계좌" onClick={() => setTab("accounts")} />
      </nav>
    </main>
  );
}

function Notice({
  message,
  tone,
  onDismiss
}: {
  message: string;
  tone?: "success";
  onDismiss: () => void;
}) {
  return (
    <div className={tone === "success" ? "notice success" : "notice"} role="status">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="알림 닫기">
        <X size={16} />
      </button>
    </div>
  );
}

function ComparisonDashboardView({
  summary,
  history,
  transactions,
  simulationResult,
  targetDate
}: {
  summary: Summary | null;
  history: HistoryPoint[];
  transactions: AssetTransaction[];
  simulationResult: SimulationResult;
  targetDate: string;
}) {
  const [activeInsightMetric, setActiveInsightMetric] = useState<string | null>(null);
  const insightMetricDetails = useMemo(
    () => (summary ? buildSummaryMetricDetails(summary, transactions, targetDate) : new Map<string, MetricDetail>()),
    [summary, transactions, targetDate]
  );
  const activeInsightDetail = activeInsightMetric ? insightMetricDetails.get(activeInsightMetric) ?? null : null;
  const toggleInsightMetric = (metricKey: string) => setActiveInsightMetric((current) => (current === metricKey ? null : metricKey));

  if (!summary) {
    return (
      <section className="insightDashboard">
        <section className="insightHero">
          <div>
            <span>비교 대시보드</span>
            <h2>데이터를 불러오는 중입니다.</h2>
          </div>
        </section>
      </section>
    );
  }

  const topAssets = assetDetailItems(
    summary.assets.filter((asset) => asset.valueKrw > 0),
    summary.totalValueKrw,
    summary.totalValueKrw
  ).slice(0, 5);
  const accountRows = summary.byAccountDetails.filter((item) => item.valueKrw > 0).slice(0, 5);
  const categoryRows = summary.byTypeDetails.filter((item) => item.valueKrw > 0);
  const topPerformers = performanceRows(summary.assets, "top");
  const bottomPerformers = performanceRows(summary.assets, "bottom");
  const liquidShare = summary.totalValueKrw > 0 ? roundNumber((summary.liquidValueKrw / summary.totalValueKrw) * 100, 1) : 0;
  const liquidityRows: DashboardRankRow[] = [
    {
      key: "liquid",
      label: "즉시 현금화",
      valueKrw: summary.liquidValueKrw,
      share: liquidShare,
      detail: "현재 기준 사용 가능"
    },
    {
      key: "account-locked",
      label: "계좌 제한",
      valueKrw: summary.accountLockedValueKrw,
      share: summary.totalValueKrw > 0 ? roundNumber((summary.accountLockedValueKrw / summary.totalValueKrw) * 100, 1) : 0,
      detail: "ISA, 연금, 만기형 계좌"
    },
    {
      key: "asset-locked",
      label: "자산 제한",
      valueKrw: summary.assetLockedValueKrw,
      share: summary.totalValueKrw > 0 ? roundNumber((summary.assetLockedValueKrw / summary.totalValueKrw) * 100, 1) : 0,
      detail: "종목별 매도 가능일"
    }
  ];
  const previousPoint = previousHistoryPoint(history, targetDate);
  const recentDelta = previousPoint ? summary.totalValueKrw - previousPoint.totalValueKrw : null;
  const periodRows = dashboardPeriodRows(summary, history, targetDate);
  const incomePeriodRows = dashboardIncomePeriodRows(summary, history, targetDate);
  const insights = dashboardRiskInsights(summary, topAssets, accountRows, bottomPerformers, history, targetDate);
  const transactionFlow = buildTransactionFlow(transactions);
  const futureLiquidDelta = simulationResult.finalPoint.liquidValueKrw - summary.liquidValueKrw;

  return (
    <section className="insightDashboard">
      <section className="insightHero">
        <div className="insightHeroCopy">
          <span>비교 대시보드</span>
          <h2>{formatKrw(summary.totalValueKrw)}</h2>
          <p>
            총 원금 {compactKrw(summary.totalCostKrw)} · 평가손익 {compactSignedKrw(summary.unrealizedGainKrw)} · 수익률 {formatPercent(summary.totalGainRate)}
          </p>
        </div>
        <div className="insightHeroStats" aria-label="핵심 비교 수치">
          <div>
            <span>최근 변화</span>
            <b className={recentDelta === null ? "" : gainClass(recentDelta)}>{recentDelta === null ? "데이터 부족" : compactSignedKrw(recentDelta)}</b>
          </div>
          <div>
            <span>현금화</span>
            <b>{formatPercent(summary.liquidRatio)}</b>
          </div>
          <div>
            <span>집중도</span>
            <b>{formatPercent(topAssets[0]?.totalShare)}</b>
          </div>
          <div>
            <span>시세 오류</span>
            <b>{summary.assets.filter((asset) => asset.lastPriceError).length}개</b>
          </div>
        </div>
      </section>

      <section className="insightKpiGrid" aria-label="비교 핵심 지표">
        <Metric
          title="총자산"
          value={compactKrw(summary.totalValueKrw)}
          detail={`기준일 ${formatDisplayDate(targetDate)}`}
          icon={<BarChart3 />}
          priority="high"
          selected={activeInsightMetric === "total-assets"}
          onClick={() => toggleInsightMetric("total-assets")}
        />
        <Metric
          title="총 원금"
          value={compactKrw(summary.totalCostKrw)}
          detail="보유 원가 기준"
          icon={<WalletCards />}
          priority="high"
          selected={activeInsightMetric === "total-cost"}
          onClick={() => toggleInsightMetric("total-cost")}
        />
        <Metric
          title="평가손익"
          value={compactSignedKrw(summary.unrealizedGainKrw)}
          detail={`총수익 ${compactSignedKrw(summary.totalIncomeKrw)}`}
          icon={<TrendingUp />}
          tone={summary.unrealizedGainKrw >= 0 ? "positive" : "negative"}
          priority="high"
          selected={activeInsightMetric === "unrealized"}
          onClick={() => toggleInsightMetric("unrealized")}
        />
        <Metric
          title="제한 금액"
          value={compactKrw(summary.lockedValueKrw)}
          detail={`계좌 ${compactKrw(summary.accountLockedValueKrw)} · 자산 ${compactKrw(summary.assetLockedValueKrw)}`}
          icon={<Landmark />}
          tone="warning"
          priority="high"
          selected={activeInsightMetric === "locked"}
          onClick={() => toggleInsightMetric("locked")}
        />
      </section>

      {activeInsightDetail && <MetricDetailPanel detail={activeInsightDetail} onClose={() => setActiveInsightMetric(null)} />}

      <section className="insightGrid">
        <article className="insightPanel wide">
          <PanelTitle icon={<Layers />} title="한눈에 보는 자산 구조" detail="분류, 계좌, 현금화 가능성을 같은 기준으로 비교합니다." />
          <DashboardStackBar rows={categoryRows.map((item) => ({ key: item.key, label: assetLabels[item.key as AssetType] ?? item.label, valueKrw: item.valueKrw, share: item.share }))} />
          <DashboardRankList
            rows={categoryRows.map((item) => ({
              key: item.key,
              label: assetLabels[item.key as AssetType] ?? item.label,
              valueKrw: item.valueKrw,
              share: item.share,
              detail: `수익률 ${formatPercent(item.gainRate)}`
            }))}
          />
        </article>

        <TransactionFlowCard flow={transactionFlow} />

        <article className="insightPanel">
          <PanelTitle icon={<WalletCards />} title="계좌별 비교" detail="계좌별 평가액과 전체 비중" />
          <DashboardRankList
            rows={accountRows.map((item) => ({
              key: item.key,
              label: item.label,
              valueKrw: item.valueKrw,
              share: item.share,
              detail: `수익률 ${formatPercent(item.gainRate)}`
            }))}
            valueFormatter={formatKrwThousands}
          />
        </article>

        <article className="insightPanel">
          <PanelTitle icon={<Target />} title="상위 비중 종목" detail="같은 종목은 합산 기준" />
          <DashboardRankList
            rows={topAssets.map((asset) => ({
              key: asset.key,
              label: asset.name,
              valueKrw: asset.valueKrw,
              share: asset.totalShare ?? 0,
              detail: `수익률 ${formatPercent(asset.gainRate)}`
            }))}
          />
        </article>

        <article className="insightPanel">
          <PanelTitle icon={<TrendingUp />} title="수익률 상위" detail="원금이 있는 보유 종목 기준" />
          <PerformanceList rows={topPerformers} emptyText="수익률을 계산할 종목 데이터가 부족합니다." />
        </article>

        <article className="insightPanel">
          <PanelTitle icon={<AlertTriangle />} title="손실·오류 확인" detail="하위 수익률과 시세 오류" />
          <PerformanceList rows={bottomPerformers} emptyText="손실률이 큰 종목이 없습니다." />
        </article>

        <article className="insightPanel wide">
          <PanelTitle icon={<CircleDollarSign />} title="현금화 가능성 비교" detail="즉시 가능, 계좌 제한, 자산 제한을 분리합니다." />
          <DashboardStackBar rows={liquidityRows} tone="liquidity" />
          <DashboardRankList rows={liquidityRows} />
          <div className="insightFutureNote">
            <span>시뮬레이션 종료 시 현금화 가능 변화</span>
            <b className={gainClass(futureLiquidDelta)}>{compactSignedKrw(futureLiquidDelta)}</b>
          </div>
        </article>

        <article className="insightPanel">
          <PanelTitle icon={<Activity />} title="기간 비교" detail="저장된 히스토리 기준" />
          <div className="periodCompareList">
            {periodRows.map((row) => (
              <div className="periodCompareRow" key={row.label}>
                <span>
                  <strong>{row.label}</strong>
                  <small>{row.date ? formatDisplayDate(row.date) : "데이터 부족"}</small>
                </span>
                <b>{row.valueKrw === null ? "-" : compactKrw(row.valueKrw)}</b>
                <em className={row.deltaKrw === null ? "" : gainClass(row.deltaKrw)}>
                  {row.deltaKrw === null ? "비교 불가" : compactSignedKrw(row.deltaKrw)}
                </em>
              </div>
            ))}
          </div>
        </article>

        <article className="insightPanel">
          <PanelTitle icon={<TrendingUp />} title="수익 변동 비교" detail="저장된 히스토리의 총수익 기준" />
          <DashboardIncomeChangeCompare rows={incomePeriodRows} />
        </article>

        <article className="insightPanel">
          <PanelTitle icon={<AlertTriangle />} title="리스크 인사이트" detail="집중도, 손실, 데이터 상태" />
          <div className="riskInsightList">
            {insights.map((item) => (
              <div className={`riskInsightItem ${item.tone}`} key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </section>
  );
}

type DashboardRankRow = {
  key: string;
  label: string;
  valueKrw: number;
  share: number;
  detail?: string;
};

type PerformanceRow = {
  key: string;
  label: string;
  valueKrw: number;
  gainKrw: number;
  gainRate: number | null;
};

type CashFlowMonthRow = {
  key: string;
  label: string;
  buyKrw: number;
  sellKrw: number;
  dividendKrw: number;
  depositKrw: number;
  realizedGainKrw: number;
  transactionCount: number;
  buyCount: number;
  sellCount: number;
  dividendCount: number;
  depositCount: number;
  netBuyKrw: number;
  grossKrw: number;
  report: CashFlowMonthReport;
};

type CashFlowReportType = "buy" | "sell" | "dividend" | "deposit";

type CashFlowReportItem = {
  key: string;
  type: CashFlowReportType;
  name: string;
  accountName: string;
  quantity: number | null;
  amountKrw: number;
  realizedGainKrw: number;
  transactionCount: number;
};

type CashFlowMonthReport = Record<CashFlowReportType, CashFlowReportItem[]>;

type CashFlowInsight = {
  key: string;
  title: string;
  detail: string;
  tone: "neutral" | "warning" | "positive" | "negative";
};

type TransactionFlowSummary = {
  rows: CashFlowMonthRow[];
  scopeLabel: string;
  totalMonthCount: number;
  totalBuyKrw: number;
  totalSellKrw: number;
  totalDividendKrw: number;
  totalDepositKrw: number;
  netBuyKrw: number;
  excludedZeroTrades: number;
  ignoredMaturityCount: number;
  depositCount: number;
  maxMonthlyGrossKrw: number;
  insights: CashFlowInsight[];
};

function PanelTitle({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="insightPanelTitle">
      <span>{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function DashboardStackBar({ rows, tone }: { rows: DashboardRankRow[]; tone?: "liquidity" }) {
  const visibleRows = rows.filter((row) => row.valueKrw > 0 && row.share > 0);

  if (visibleRows.length === 0) {
    return <span className="emptyText">비교할 데이터가 없습니다.</span>;
  }

  return (
    <div className="dashboardStackBar" aria-label="자산 구성 비중">
      {visibleRows.map((row, index) => (
        <span
          key={row.key}
          style={{
            width: `${Math.max(2, row.share)}%`,
            background: tone === "liquidity" ? liquidityDashboardColor(row.key) : allocationColors[index % allocationColors.length]
          }}
          title={`${row.label} ${formatPercent(row.share)}`}
        />
      ))}
    </div>
  );
}

function DashboardRankList({
  rows,
  valueFormatter = formatKrw
}: {
  rows: DashboardRankRow[];
  valueFormatter?: (value: number) => string;
}) {
  const visibleRows = rows.filter((row) => row.valueKrw > 0);

  if (visibleRows.length === 0) {
    return <span className="emptyText">비교할 데이터가 없습니다.</span>;
  }

  return (
    <div className="dashboardRankList">
      {visibleRows.map((row, index) => (
        <div className="dashboardRankRow" key={row.key}>
          <div className="dashboardRankMain">
            <span>
              <i style={{ background: liquidityDashboardColor(row.key) || allocationColors[index % allocationColors.length] }} />
              <strong>{row.label}</strong>
            </span>
            <b>{valueFormatter(row.valueKrw)}</b>
          </div>
          <div className="dashboardRankMeta">
            <span>{row.detail ?? `전체 ${formatPercent(row.share)}`}</span>
            <em>{formatPercent(row.share)}</em>
          </div>
          <span className="dashboardRankBar" aria-hidden="true">
            <i
              style={{
                width: `${Math.max(2, Math.min(100, row.share))}%`,
                background: liquidityDashboardColor(row.key) || allocationColors[index % allocationColors.length]
              }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function PerformanceList({ rows, emptyText }: { rows: PerformanceRow[]; emptyText: string }) {
  if (rows.length === 0) {
    return <span className="emptyText">{emptyText}</span>;
  }

  return (
    <div className="performanceList">
      {rows.map((row) => (
        <div className="performanceRow" key={row.key}>
          <span>
            <strong>{row.label}</strong>
            <small>{formatKrw(row.valueKrw)}</small>
          </span>
          <span>
            <b className={gainClass(row.gainKrw)}>{compactSignedKrw(row.gainKrw)}</b>
            <em className={gainClass(row.gainKrw)}>{formatPercent(row.gainRate)}</em>
          </span>
        </div>
      ))}
    </div>
  );
}

function TransactionFlowCard({ flow }: { flow: TransactionFlowSummary }) {
  const [expandedMonthKey, setExpandedMonthKey] = useState<string | null>(null);

  return (
    <article className="insightPanel wide cashFlowPanel">
      <PanelTitle icon={<Banknote />} title="거래 흐름" detail={`${flow.scopeLabel} 매수, 매도, 배당, 입금성 거래를 월별로 비교합니다.`} />
      {flow.rows.length === 0 ? (
        <div className="cashFlowEmpty">
          <span className="emptyText">표시할 매수/매도/배당 흐름이 없습니다.</span>
          {(flow.excludedZeroTrades > 0 || flow.ignoredMaturityCount > 0) && (
            <span>
              0주 거래 {flow.excludedZeroTrades.toLocaleString("ko-KR")}건, 만기 거래 {flow.ignoredMaturityCount.toLocaleString("ko-KR")}건은 흐름 계산에서 제외했습니다.
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="cashFlowSummaryGrid">
            <div className="cashFlowSummaryItem net">
              <span>순매수</span>
              <b>{compactSignedKrw(flow.netBuyKrw)}</b>
              <small>매수 - 매도</small>
            </div>
            <div className="cashFlowSummaryItem buy">
              <span>총 매수</span>
              <b>{compactKrw(flow.totalBuyKrw)}</b>
              <small>매수 대금 기준</small>
            </div>
            <div className="cashFlowSummaryItem sell">
              <span>총 매도</span>
              <b>{compactKrw(flow.totalSellKrw)}</b>
              <small>실현손익과 별도</small>
            </div>
            <div className="cashFlowSummaryItem dividend">
              <span>배당/입금</span>
              <b>{compactKrw(flow.totalDividendKrw)}</b>
              <small>입금 참고 {compactKrw(flow.totalDepositKrw)}</small>
            </div>
          </div>

          <div className="cashFlowMonthList" aria-label="월별 거래 흐름">
            {flow.rows.map((row) => {
              const scaleWidth = flow.maxMonthlyGrossKrw > 0 ? Math.max(3, (row.grossKrw / flow.maxMonthlyGrossKrw) * 100) : 0;
              const segments = cashFlowSegments(row).filter((segment) => segment.valueKrw > 0);
              const isExpanded = expandedMonthKey === row.key;

              return (
                <article className={isExpanded ? "cashFlowMonthRow expanded" : "cashFlowMonthRow"} key={row.key}>
                  <button
                    type="button"
                    className="cashFlowMonthButton"
                    aria-expanded={isExpanded}
                    aria-controls={`cash-flow-report-${row.key}`}
                    onClick={() => setExpandedMonthKey((current) => (current === row.key ? null : row.key))}
                  >
                    <div className="cashFlowMonthHead">
                      <strong>{row.label}</strong>
                      <span>{row.transactionCount.toLocaleString("ko-KR")}건 · {isExpanded ? "접기" : "상세"}</span>
                    </div>
                    <div className="cashFlowMonthStats">
                      <span>
                        <em>매수</em>
                        <b>{compactKrw(row.buyKrw)}</b>
                      </span>
                      <span>
                        <em>매도</em>
                        <b>{compactKrw(row.sellKrw)}</b>
                      </span>
                      <span>
                        <em>배당</em>
                        <b>{compactKrw(row.dividendKrw)}</b>
                      </span>
                      {flow.depositCount > 0 && (
                        <span>
                          <em>입금</em>
                          <b>{compactKrw(row.depositKrw)}</b>
                        </span>
                      )}
                    </div>
                    <div className="cashFlowMonthNet">
                      <span>순매수 {compactSignedKrw(row.netBuyKrw)}</span>
                      {row.realizedGainKrw !== 0 && <em className={gainClass(row.realizedGainKrw)}>실현 {compactSignedKrw(row.realizedGainKrw)}</em>}
                    </div>
                    <div className="cashFlowStackTrack" aria-label={`${row.label} 거래 대금 비교`}>
                      <div className="cashFlowStackScale" style={{ width: `${scaleWidth}%` }}>
                        {segments.map((segment) => (
                          <span
                            className={segment.key}
                            key={segment.key}
                            style={{ width: `${(segment.valueKrw / row.grossKrw) * 100}%` }}
                            title={`${segment.label} ${formatKrw(segment.valueKrw)}`}
                          />
                        ))}
                      </div>
                    </div>
                  </button>
                  {isExpanded && <CashFlowMonthReportView row={row} id={`cash-flow-report-${row.key}`} />}
                </article>
              );
            })}
          </div>

          <div className="cashFlowInsights">
            {flow.insights.map((item) => (
              <div className={`cashFlowInsight ${item.tone}`} key={item.key}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            ))}
          </div>

          <p className="cashFlowFootnote">
            순매수는 매수 대금에서 매도 대금을 뺀 값입니다. 실제 현금 입출금, 환전, 입금성 거래와는 다를 수 있습니다.
          </p>
        </>
      )}
    </article>
  );
}

function CashFlowMonthReportView({ row, id }: { row: CashFlowMonthRow; id: string }) {
  const sections: Array<{ type: CashFlowReportType; title: string; amountLabel: string; rows: CashFlowReportItem[] }> = [
    { type: "buy" as CashFlowReportType, title: "매수", amountLabel: "매수", rows: row.report.buy },
    { type: "sell" as CashFlowReportType, title: "매도", amountLabel: "매도", rows: row.report.sell },
    { type: "dividend" as CashFlowReportType, title: "배당", amountLabel: "배당", rows: row.report.dividend },
    { type: "deposit" as CashFlowReportType, title: "입금", amountLabel: "입금", rows: row.report.deposit }
  ].filter((section) => section.rows.length > 0);

  return (
    <div className="cashFlowReport" id={id}>
      <p className="cashFlowReportSummary">
        <strong>{cashFlowMonthReportTitle(row)}</strong>
        <span>
          순매수 {compactSignedKrw(row.netBuyKrw)} · 실현손익 {compactSignedKrw(row.realizedGainKrw)} · 배당 {compactKrw(row.dividendKrw)}
        </span>
      </p>
      <div className="cashFlowReportSections">
        {sections.map((section) => (
          <section className={`cashFlowReportSection ${section.type}`} key={section.type}>
            <h4>{section.title}</h4>
            <div className="cashFlowReportItems">
              {section.rows.map((item) => (
                <div className="cashFlowReportItem" key={item.key}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.accountName}
                      {item.quantity !== null ? ` · ${formatQuantity(item.quantity)}주` : ""}
                      {item.transactionCount > 1 ? ` · ${item.transactionCount.toLocaleString("ko-KR")}건 합산` : ""}
                      {item.type === "deposit" ? " · 참고용" : ""}
                    </small>
                  </span>
                  <span>
                    <b>{compactKrw(item.amountKrw)}</b>
                    {item.type === "sell" && <em className={gainClass(item.realizedGainKrw)}>실현 {compactSignedKrw(item.realizedGainKrw)}</em>}
                    {item.type !== "sell" && <em>{section.amountLabel} 금액</em>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function SimulationView({
  result,
  incomes,
  accounts,
  editingIncomeId,
  range,
  endDate,
  monthlyForm,
  oneTimeForm,
  onRangeChange,
  onEndDateChange,
  onMonthlyFormChange,
  onOneTimeFormChange,
  onAddMonthlyIncome,
  onAddOneTimeIncome,
  onCancelIncomeEdit,
  onEditIncome,
  onRemoveIncome
}: {
  result: SimulationResult;
  incomes: SimulationIncome[];
  accounts: Account[];
  editingIncomeId: string | null;
  range: SimulationRange;
  endDate: string;
  monthlyForm: SimulationIncomeForm;
  oneTimeForm: SimulationIncomeForm;
  onRangeChange: (range: string) => void;
  onEndDateChange: (dateValue: string) => void;
  onMonthlyFormChange: (form: SimulationIncomeForm) => void;
  onOneTimeFormChange: (form: SimulationIncomeForm) => void;
  onAddMonthlyIncome: (event: FormEvent) => void;
  onAddOneTimeIncome: (event: FormEvent) => void;
  onCancelIncomeEdit: () => void;
  onEditIncome: (income: SimulationIncome) => void;
  onRemoveIncome: (id: string) => void;
}) {
  const finalPoint = result.finalPoint;
  const liquidityRatio = finalPoint.totalValueKrw > 0 ? (finalPoint.liquidValueKrw / finalPoint.totalValueKrw) * 100 : 0;
  const editingIncome = editingIncomeId ? incomes.find((income) => income.id === editingIncomeId) ?? null : null;
  const [selectedSimulationDate, setSelectedSimulationDate] = useState(finalPoint.date);
  const [activeIncomeFormType, setActiveIncomeFormType] = useState<SimulationIncomeType | null>(null);
  const selectedPointIndex = Math.max(
    0,
    result.points.findIndex((point) => point.date === selectedSimulationDate)
  );
  const selectedPoint = result.points[selectedPointIndex] ?? finalPoint;
  const previousSelectedPoint = selectedPointIndex > 0 ? result.points[selectedPointIndex - 1] : null;
  const finalDeltaKrw = finalPoint.totalValueKrw - result.startingAssetsKrw;
  const assumptionSummary = buildSimulationAssumptionSummary(result.assetRows);
  const assumptionGroups = buildSimulationAssumptionGroups(result.assetRows);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const [activeSimulationMetric, setActiveSimulationMetric] = useState<string | null>(null);
  const simulationMetricDetails = useMemo(
    () => buildSimulationMetricDetails(result, incomes, accounts, today, endDate),
    [result, incomes, accounts, endDate]
  );
  const activeSimulationDetail = activeSimulationMetric ? simulationMetricDetails.get(activeSimulationMetric) ?? null : null;
  const toggleSimulationMetric = (metricKey: string) =>
    setActiveSimulationMetric((current) => (current === metricKey ? null : metricKey));

  useEffect(() => {
    if (!result.points.some((point) => point.date === selectedSimulationDate)) {
      setSelectedSimulationDate(finalPoint.date);
    }
  }, [finalPoint.date, result.points, selectedSimulationDate]);

  useEffect(() => {
    if (editingIncome) {
      setActiveIncomeFormType(editingIncome.type);
    }
  }, [editingIncome?.id, editingIncome?.type]);

  function openIncomeEditor(type: SimulationIncomeType) {
    if (editingIncome) onCancelIncomeEdit();
    setActiveIncomeFormType(type);
  }

  function closeIncomeEditor() {
    if (editingIncome) onCancelIncomeEdit();
    setActiveIncomeFormType(null);
  }

  return (
    <section className="simulationPage">
      <section className="simulationHero">
        <div>
          <span>종료 시점 예상 총자산</span>
          <strong>{formatKrw(finalPoint.totalValueKrw)}</strong>
          <p>
            시작 대비 {compactSignedKrw(finalDeltaKrw)} · 시작 자산 {compactKrw(result.startingAssetsKrw)} · 예상 수입{" "}
            {compactKrw(result.cumulativeIncomeKrw)}
          </p>
        </div>
        <div className="simulationLiquidity">
          <div>
            <span>현금화 가능</span>
            <b>{formatPercent(liquidityRatio)}</b>
          </div>
          <LiquiditySplitBar liquidRatio={liquidityRatio} />
          <small>
            {compactKrw(finalPoint.liquidValueKrw)} 가능 · {compactKrw(finalPoint.lockedValueKrw)} 제한
          </small>
          {finalPoint.lockedValueKrw > 0 && (
            <small>
              계좌 {compactKrw(finalPoint.accountLockedValueKrw)} · 자산 {compactKrw(finalPoint.assetLockedValueKrw)}
            </small>
          )}
        </div>
      </section>

      <section className="simulationMetricGrid" aria-label="시뮬레이션 요약">
        <Metric
          title="예상 총자산"
          value={compactKrw(finalPoint.totalValueKrw)}
          detail={`시작 대비 ${compactSignedKrw(finalDeltaKrw)}`}
          icon={<BarChart3 />}
          selected={activeSimulationMetric === "simulation-total"}
          onClick={() => toggleSimulationMetric("simulation-total")}
        />
        <Metric
          title="현금화 가능"
          value={compactKrw(finalPoint.liquidValueKrw)}
          icon={<CircleDollarSign />}
          tone="positive"
          selected={activeSimulationMetric === "simulation-liquid"}
          onClick={() => toggleSimulationMetric("simulation-liquid")}
        />
        <Metric
          title="제한 자산"
          value={compactKrw(finalPoint.lockedValueKrw)}
          detail={`계좌 ${compactKrw(finalPoint.accountLockedValueKrw)} · 자산 ${compactKrw(finalPoint.assetLockedValueKrw)}`}
          icon={<Landmark />}
          tone="warning"
          selected={activeSimulationMetric === "simulation-locked"}
          onClick={() => toggleSimulationMetric("simulation-locked")}
        />
        <Metric
          title="누적 예상 수입"
          value={compactKrw(result.cumulativeIncomeKrw)}
          detail={`입력값 ${incomes.length}개`}
          icon={<Banknote />}
          selected={activeSimulationMetric === "simulation-income"}
          onClick={() => toggleSimulationMetric("simulation-income")}
        />
      </section>

      {activeSimulationDetail && <MetricDetailPanel detail={activeSimulationDetail} onClose={() => setActiveSimulationMetric(null)} />}

      <section className="panel simulationChartPanel">
        <div className="sectionHeader">
          <div>
            <h2>미래 추이</h2>
            <span>현재 자산은 평가금액 고정, 월별 기준에 수입일과 제한 해제일을 함께 반영합니다.</span>
          </div>
          <div className="sectionControls">
            <Segmented options={simulationRangeLabels} value={range} onChange={onRangeChange} />
            <label className="simulationEndDate">
              종료일
              <input type="date" value={endDate} min={today} onChange={(event) => onEndDateChange(event.target.value)} />
            </label>
          </div>
        </div>
        <SimulationChart points={result.points} selectedDate={selectedPoint.date} onSelectDate={setSelectedSimulationDate} />
        <SimulationPointDetailPanel point={selectedPoint} previousPoint={previousSelectedPoint} />
      </section>

      <section className="panel simulationTablePanel">
        <div className="sectionHeader">
          <div>
            <h2>기간별 예상 변동</h2>
            <span>월별 기준에 수입일과 제한 해제일을 함께 반영합니다.</span>
          </div>
        </div>
        <SimulationTable
          points={result.points}
          selectedDate={selectedPoint.date}
          onSelectDate={setSelectedSimulationDate}
        />
      </section>

      <section className="panel simulationAssumptionPanel">
        <div className="sectionHeader">
          <div>
            <h2>현재 자산 가정</h2>
            <span>시작 자산을 현금화 가능 상태와 제한 사유별로 정리합니다.</span>
          </div>
        </div>
        {result.assetRows.length === 0 ? (
          <span className="emptyText">시뮬레이션에 반영할 자산이 없습니다.</span>
        ) : (
          <>
            <div className="simulationAssumptionSummary">
              {assumptionSummary.map((item) => (
                <span key={item.key}>
                  <b>{item.label}</b>
                  <strong>{compactKrw(item.valueKrw)}</strong>
                  <small>{item.count}개</small>
                </span>
              ))}
            </div>
            <div className="simulationAssumptionGroups">
              {assumptionGroups.map((group) => (
                <details className="simulationAssumptionGroup" key={group.key}>
                  <summary>
                    <span>
                      <strong>{group.label}</strong>
                      <small>{group.assets.length}개 자산</small>
                    </span>
                    <b>{formatKrw(group.valueKrw)}</b>
                  </summary>
                  <div className="simulationAssumptionList">
                    {group.assets.map((asset) => (
                      <div className="simulationAssumptionRow" key={`${group.key}-${asset.id}`}>
                        <div>
                          <strong>{asset.name}</strong>
                          <span>
                            {asset.accountName} · {simulationAssetStateText(asset)}
                          </span>
                          {asset.state !== "liquid" && <small>{asset.restrictionText}</small>}
                        </div>
                        <b>{formatKrw(asset.valueKrw)}</b>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="panel simulationIncomePanel">
        <div className="sectionHeader">
          <div>
            <h2>입력값 관리</h2>
            <span>{incomes.length}개 예상 수입 · 저장 시 미래 추이에 바로 반영됩니다.</span>
          </div>
          <div className="simulationIncomeToolbar">
            <button
              className={activeIncomeFormType === "monthly" && !editingIncome ? "active" : ""}
              type="button"
              onClick={() => openIncomeEditor("monthly")}
            >
              <Plus size={16} />
              월 반복
            </button>
            <button
              className={activeIncomeFormType === "one_time" && !editingIncome ? "active" : ""}
              type="button"
              onClick={() => openIncomeEditor("one_time")}
            >
              <Plus size={16} />
              일회성
            </button>
          </div>
        </div>
        <SimulationIncomeList
          accountById={accountById}
          incomes={incomes}
          editingIncomeId={editingIncomeId}
          onEdit={onEditIncome}
          onRemove={onRemoveIncome}
        />
        {activeIncomeFormType && (
          <div className="simulationFormPanel">
            <div className="simulationFormPanelHeader">
              <strong>
                {editingIncome
                  ? `${editingIncome.name} 수정 중`
                  : activeIncomeFormType === "monthly"
                    ? "월 반복 수입 추가"
                    : "일회성 수입 추가"}
              </strong>
              <span>입력한 조건의 금액과 현금화 가능일을 미리 확인하고 저장합니다.</span>
            </div>
            <SimulationIncomeForm
              type={activeIncomeFormType}
              accounts={accounts}
              form={activeIncomeFormType === "monthly" ? monthlyForm : oneTimeForm}
              isEditing={editingIncome?.type === activeIncomeFormType}
              onChange={activeIncomeFormType === "monthly" ? onMonthlyFormChange : onOneTimeFormChange}
              onCancelEdit={closeIncomeEditor}
              onSubmit={activeIncomeFormType === "monthly" ? onAddMonthlyIncome : onAddOneTimeIncome}
            />
          </div>
        )}
      </section>
    </section>
  );
}

function DashboardIncomeChangeCompare({ rows }: { rows: DashboardIncomePeriodRow[] }) {
  return (
    <div className="periodCompareList">
      {rows.map((row) => (
        <div className="periodCompareRow" key={row.label}>
          <span>
            <strong>{row.label}</strong>
            <small>
              {row.date && row.valueKrw !== null
                ? `${formatDisplayDate(row.date)} · 기준 ${compactSignedKrw(row.valueKrw)}`
                : "데이터 부족"}
            </small>
          </span>
          <b className={row.deltaKrw === null ? "" : gainClass(row.deltaKrw)}>
            {row.deltaKrw === null ? "-" : compactSignedKrw(row.deltaKrw)}
          </b>
          <em className={row.deltaKrw === null ? "" : gainClass(row.deltaKrw)}>
            {formatDashboardIncomeChangeRate(row)}
          </em>
        </div>
      ))}
    </div>
  );
}

function formatDashboardIncomeChangeRate(row: DashboardIncomePeriodRow) {
  if (row.deltaKrw === null) return "비교 불가";
  if (row.rate !== null) return formatPercent(row.rate);
  if (row.valueKrw === 0 && row.deltaKrw > 0) return "신규 수익";
  return "비율 불가";
}

function SimulationChart({
  points,
  selectedDate,
  onSelectDate
}: {
  points: SimulationPoint[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const width = 340;
  const height = 180;
  const leftPadding = 46;
  const rightPadding = 14;
  const topPadding = 16;
  const bottomPadding = 26;
  const chartBottom = height - bottomPadding;
  const rawMaxValue = Math.max(
    1,
    ...points.flatMap((point) => [point.totalValueKrw, point.liquidValueKrw, point.lockedValueKrw, point.cumulativeIncomeKrw])
  );
  const yTicks = chartYAxisTicks(rawMaxValue);
  const maxValue = yTicks[yTicks.length - 1]?.value ?? rawMaxValue;
  const xStep = points.length > 1 ? (width - leftPadding - rightPadding) / (points.length - 1) : 0;
  const toX = (index: number) => (points.length > 1 ? leftPadding + index * xStep : (leftPadding + width - rightPadding) / 2);
  const toY = (value: number) => chartBottom - (value / maxValue) * (chartBottom - topPadding);
  const linePoints = (selector: (point: SimulationPoint) => number) =>
    points.map((point, index) => `${toX(index)},${toY(selector(point))}`).join(" ");
  const selectedIndex = points.findIndex((point) => point.date === selectedDate);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : Math.max(0, points.length - 1);
  const activePoint = points[activeIndex] ?? null;
  const activeX = activePoint ? toX(activeIndex) : 0;
  const labelX = activeX > width / 2 ? activeX - 123 : activeX + 8;
  const markerIndexes = visibleTimelineMarkerIndexes(points.length, activeIndex);

  function moveSelectedPoint(delta: number) {
    if (points.length === 0) return;
    const nextIndex = Math.max(0, Math.min(points.length - 1, activeIndex + delta));
    onSelectDate(points[nextIndex].date);
  }

  function handleChartKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    moveSelectedPoint(event.key === "ArrowRight" ? 1 : -1);
  }

  function selectPoint(event: PointerEvent<SVGSVGElement>, shouldFocus = false) {
    if (points.length === 0) return;
    if (shouldFocus) chartRef.current?.focus({ preventScroll: true });
    const rect = event.currentTarget.getBoundingClientRect();
    const chartRight = width - rightPadding;
    const x = Math.max(leftPadding, Math.min(chartRight, ((event.clientX - rect.left) / rect.width) * width));
    const index = points.length > 1 ? Math.round((x - leftPadding) / (xStep || 1)) : 0;
    onSelectDate(points[Math.max(0, Math.min(points.length - 1, index))].date);
  }

  if (points.length === 0) {
    return <span className="emptyText">표시할 시뮬레이션 데이터가 없습니다.</span>;
  }

  return (
    <div
      ref={chartRef}
      className="simulationChartWrap"
      aria-label="시뮬레이션 미래 추이 그래프"
      onKeyDown={handleChartKeyDown}
      role="group"
      tabIndex={0}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="시뮬레이션 미래 추이 그래프"
        onPointerDown={(event) => selectPoint(event, true)}
        onPointerMove={(event) => {
          if (event.buttons > 0 || event.pointerType === "touch") selectPoint(event);
        }}
      >
        <g className="chartGrid">
          {yTicks.map((tick, index) => (
            <g className="chartYAxisTick" key={`${tick.value}-${index}`}>
              <line x1={leftPadding} x2={width - rightPadding} y1={toY(tick.value)} y2={toY(tick.value)} />
              <text x="4" y={toY(tick.value)} dominantBaseline="middle">
                {formatAxisKrw(tick.value)}
              </text>
            </g>
          ))}
        </g>
        <polyline points={linePoints((point) => point.totalValueKrw)} className="simulationLine total" vectorEffect="non-scaling-stroke" />
        <polyline points={linePoints((point) => point.liquidValueKrw)} className="simulationLine liquid" vectorEffect="non-scaling-stroke" />
        <polyline points={linePoints((point) => point.lockedValueKrw)} className="simulationLine locked" vectorEffect="non-scaling-stroke" />
        <polyline points={linePoints((point) => point.cumulativeIncomeKrw)} className="simulationLine income" vectorEffect="non-scaling-stroke" />
        {markerIndexes.map((index) => (
          <circle className="chartMarker" key={points[index].date} cx={toX(index)} cy={toY(points[index].totalValueKrw)} r="1.6" />
        ))}
        {activePoint && (
          <g className="chartTooltip">
            <line x1={activeX} x2={activeX} y1={topPadding} y2={chartBottom} vectorEffect="non-scaling-stroke" />
            <circle className="activeTotalPoint" cx={activeX} cy={toY(activePoint.totalValueKrw)} r="4.2" />
            <circle className="activeLiquidPoint" cx={activeX} cy={toY(activePoint.liquidValueKrw)} r="4.2" />
            <rect x={labelX} y="12" width="115" height="86" rx="8" />
            <text className="tooltipDate" x={labelX + 9} y="29">
              {formatDisplayDate(activePoint.date)}
            </text>
            <text x={labelX + 9} y="47">전체 {compactKrw(activePoint.totalValueKrw)}</text>
            <text x={labelX + 9} y="62">현금화 {compactKrw(activePoint.liquidValueKrw)}</text>
            <text x={labelX + 9} y="77">제한 {compactKrw(activePoint.lockedValueKrw)}</text>
            <text x={labelX + 9} y="92">수입 {compactKrw(activePoint.cumulativeIncomeKrw)}</text>
          </g>
        )}
      </svg>
      <div className="chartAxis">
        {chartAxisPoints(points).map((point) => (
          <span key={`${point.date}-${point.align}`} className={point.align}>
            {formatDisplayDate(point.date)}
          </span>
        ))}
      </div>
      <div className="simulationLegend">
        <span><i className="legendTotal" /> 총자산</span>
        <span><i className="legendLiquid" /> 현금화</span>
        <span><i className="legendLocked" /> 제한</span>
        <span><i className="legendIncome" /> 수입</span>
      </div>
    </div>
  );
}

function SimulationTable({
  points,
  selectedDate,
  onSelectDate
}: {
  points: SimulationPoint[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const [expandedCardDate, setExpandedCardDate] = useState<string | null>(null);
  const rows = points.map((point, index) => ({
    point,
    previousPoint: index === 0 ? null : points[index - 1],
    deltaKrw: index === 0 ? 0 : point.totalValueKrw - points[index - 1].totalValueKrw
  }));

  return (
    <>
      <div className="simulationTable" role="table" aria-label="기간별 시뮬레이션 결과">
        <div className="simulationTableHeader" role="row">
          <span role="columnheader">기준일</span>
          <span role="columnheader">예상 총자산</span>
          <span role="columnheader">현금화 가능</span>
          <span role="columnheader">제한</span>
          <span role="columnheader">누적 수입</span>
        </div>
        {rows.map(({ point }) => (
          <button
            className={point.date === selectedDate ? "simulationTableRow active" : "simulationTableRow"}
            type="button"
            role="row"
            key={point.date}
            onClick={() => onSelectDate(point.date)}
          >
            <strong role="cell">{formatDisplayDate(point.date)}</strong>
            <span role="cell">{formatKrw(point.totalValueKrw)}</span>
            <span role="cell">{formatKrw(point.liquidValueKrw)}</span>
            <span role="cell">{formatKrw(point.lockedValueKrw)}</span>
            <span role="cell">{formatKrw(point.cumulativeIncomeKrw)}</span>
          </button>
        ))}
      </div>

      <div className="simulationCardList" aria-label="기간별 시뮬레이션 요약">
        {rows.map(({ point, previousPoint, deltaKrw }) => {
          const isExpanded = point.date === expandedCardDate;
          return (
            <article
              className={isExpanded ? "mobileSummaryCard simulationPeriodCard active" : "mobileSummaryCard simulationPeriodCard"}
              key={point.date}
            >
              <button
                className="simulationPeriodButton"
                type="button"
                aria-expanded={isExpanded}
                onClick={() => {
                  onSelectDate(point.date);
                  setExpandedCardDate(isExpanded ? null : point.date);
                }}
              >
                <div className="mobileSummaryCardHeader">
                  <strong>{formatDisplayDate(point.date)}</strong>
                  <span className={gainClass(deltaKrw)}>
                    {deltaKrw === 0 ? "시작값" : `변동 ${compactSignedKrw(deltaKrw)}`}
                  </span>
                </div>
                <div className="mobileSummaryPrimary">
                  <span>예상 총자산</span>
                  <b>{formatKrw(point.totalValueKrw)}</b>
                </div>
                <div className="mobileSummaryMeta">
                  <span>현금화 {compactKrw(point.liquidValueKrw)}</span>
                  <span>제한 {compactKrw(point.lockedValueKrw)}</span>
                  <span>수입 {compactKrw(point.cumulativeIncomeKrw)}</span>
                </div>
              </button>
              {isExpanded && <SimulationPointDetailPanel point={point} previousPoint={previousPoint} compact />}
            </article>
          );
        })}
      </div>
    </>
  );
}

function SimulationPointDetailPanel({
  point,
  previousPoint,
  compact = false
}: {
  point: SimulationPoint;
  previousPoint: SimulationPoint | null;
  compact?: boolean;
}) {
  const isMonthlyPoint = Boolean(point.periodStartDate && point.periodEndDate);
  const releasedValueKrw =
    point.detail.releasedAssets.reduce((sum, asset) => sum + asset.valueKrw, 0) +
    point.detail.releasedIncomes.reduce((sum, event) => sum + event.amountKrw, 0);
  const deltaTotalKrw = previousPoint ? point.totalValueKrw - previousPoint.totalValueKrw : 0;
  const deltaLiquidKrw = previousPoint ? point.liquidValueKrw - previousPoint.liquidValueKrw : 0;
  const deltaLockedKrw = previousPoint ? point.lockedValueKrw - previousPoint.lockedValueKrw : 0;
  const hasDetail =
    point.detail.newIncomes.length > 0 ||
    point.detail.releasedAssets.length > 0 ||
    point.detail.releasedIncomes.length > 0 ||
    point.detail.accountLockedItems.length > 0 ||
    point.detail.assetLockedItems.length > 0;

  return (
    <div className={compact ? "simulationPointDetail compact" : "simulationPointDetail"}>
      <div className="simulationPointDetailHeader">
        <div>
          <span>{isMonthlyPoint ? "선택월 상세" : "선택일 상세"}</span>
          <strong>{isMonthlyPoint ? formatDisplayMonth(point.date) : formatDisplayDate(point.date)}</strong>
          {isMonthlyPoint && <small>기준일 {formatDisplayDate(point.periodEndDate ?? point.date)}</small>}
        </div>
        <div>
          <span>직전 대비</span>
          <b className={gainClass(deltaTotalKrw)}>{previousPoint ? compactSignedKrw(deltaTotalKrw) : "시작값"}</b>
        </div>
      </div>
      <div className="simulationDetailMetrics">
        <span>
          <b>{compactKrw(point.incomeKrw)}</b>
          <small>신규 수입</small>
        </span>
        <span>
          <b>{compactKrw(releasedValueKrw)}</b>
          <small>현금화 전환</small>
        </span>
        <span>
          <b>{compactKrw(point.cumulativeIncomeKrw)}</b>
          <small>누적 수입</small>
        </span>
        <span>
          <b>{compactSignedKrw(deltaLiquidKrw)}</b>
          <small>현금화 변화</small>
        </span>
        <span>
          <b>{compactSignedKrw(deltaLockedKrw)}</b>
          <small>제한 변화</small>
        </span>
      </div>
      {!hasDetail ? (
        <span className="emptyText">이 날짜에는 신규 수입이나 제한 해제 내역이 없습니다.</span>
      ) : (
        <div className="simulationDetailSections">
          <SimulationDetailSection
            title="신규 수입"
            emptyText="신규 수입 없음"
            items={point.detail.newIncomes.map((event) => ({
              id: event.id,
              name: event.name,
              amountKrw: event.amountKrw,
              meta: simulationIncomeEventMeta(event)
            }))}
          />
          <SimulationDetailSection
            title="제한 해제"
            emptyText="해제 내역 없음"
            items={[
              ...point.detail.releasedAssets.map((asset) => ({
                id: asset.id,
                name: asset.name,
                amountKrw: asset.valueKrw,
                meta: `${asset.accountName} · ${asset.restrictionText}`
              })),
              ...point.detail.releasedIncomes.map((event) => ({
                id: event.id,
                name: event.name,
                amountKrw: event.amountKrw,
                meta: simulationIncomeEventMeta(event)
              }))
            ]}
          />
          <SimulationDetailSection
            title="계좌 제한"
            emptyText="계좌 제한 없음"
            items={point.detail.accountLockedItems.slice(0, compact ? 2 : 4).map((item) => ({
              key: item.key,
              id: item.id,
              name: item.name,
              amountKrw: item.amountKrw,
              meta: simulationLockedItemMeta(item)
            }))}
            totalValueKrw={point.accountLockedValueKrw}
          />
          <SimulationDetailSection
            title="자산 제한"
            emptyText="자산 제한 없음"
            items={point.detail.assetLockedItems.map((item) => ({
              key: item.key,
              id: item.id,
              name: item.name,
              amountKrw: item.amountKrw,
              meta: simulationLockedItemMeta(item)
            }))}
            totalValueKrw={point.assetLockedValueKrw}
          />
        </div>
      )}
    </div>
  );
}

function SimulationDetailSection({
  title,
  items,
  emptyText,
  totalValueKrw
}: {
  title: string;
  items: Array<{ key?: string; id: string; name: string; amountKrw: number; meta: string }>;
  emptyText: string;
  totalValueKrw?: number;
}) {
  return (
    <section className="simulationDetailSection">
      <div className="simulationDetailSectionHeader">
        <strong>{title}</strong>
        {totalValueKrw !== undefined && <span>{compactKrw(totalValueKrw)}</span>}
      </div>
      {items.length === 0 ? (
        <small>{emptyText}</small>
      ) : (
        items.map((item) => (
          <div className="simulationDetailItem" key={item.key ?? `${item.id}-${item.meta}`}>
            <span>
              <b>{item.name}</b>
              <small>{item.meta}</small>
            </span>
            <strong>{compactKrw(item.amountKrw)}</strong>
          </div>
        ))
      )}
    </section>
  );
}

function LiquidityReleaseTable({ assets, points }: { assets: AssetValuation[]; points: HistoryPoint[] }) {
  const pointByDate = new Map(points.map((point) => [point.date, point]));
  const rangeStart = points[0]?.date;
  const rangeEnd = points[points.length - 1]?.date;
  const releaseGroups = assets
    .filter((asset) => asset.liquidFrom > asset.valuationDate)
    .filter((asset) => (!rangeStart || asset.liquidFrom >= rangeStart) && (!rangeEnd || asset.liquidFrom <= rangeEnd))
    .reduce<Record<string, AssetValuation[]>>((groups, asset) => {
      groups[asset.liquidFrom] = [...(groups[asset.liquidFrom] ?? []), asset];
      return groups;
    }, {});

  const rows = Object.entries(releaseGroups)
    .map(([date, releasedAssets]) => ({
      date,
      releasedAssets,
      point: pointByDate.get(date),
      releasedValueKrw: releasedAssets.reduce((sum, asset) => sum + asset.valueKrw, 0)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (rows.length === 0) {
    return <span className="emptyText">선택한 기간 안에 매도 제한이 풀리는 자산이 없습니다.</span>;
  }

  return (
    <>
      <div className="releaseTable" role="table" aria-label="매도 제한 해제 일정">
        <div className="releaseHeader" role="row">
          <span role="columnheader">해제일</span>
          <span role="columnheader">해제 자산</span>
          <span role="columnheader">현황</span>
        </div>
        {rows.map((row) => (
          <div className="releaseRow" role="row" key={row.date}>
            <div role="cell">
              <strong>{formatDisplayDate(row.date)}</strong>
              <span>{row.releasedAssets.length}개 해제</span>
            </div>
            <div role="cell">
              {row.releasedAssets.map((asset) => (
                <span className="releaseAsset" key={asset.id}>
                  {asset.name} · {formatKrw(asset.valueKrw)}
                </span>
              ))}
            </div>
            <div role="cell">
              <b>현금화 {formatKrw(row.point?.liquidValueKrw ?? 0)}</b>
              <span>제한 {formatKrw(row.point?.lockedValueKrw ?? 0)}</span>
              <span>해제분 {formatKrw(row.releasedValueKrw)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="releaseCardList" aria-label="매도 제한 해제 요약">
        {rows.map((row) => (
          <article className="mobileSummaryCard" key={row.date}>
            <div className="mobileSummaryCardHeader">
              <strong>{formatDisplayDate(row.date)}</strong>
              <span>{row.releasedAssets.length}개 해제</span>
            </div>
            <div className="mobileSummaryPrimary">
              <span>총자산</span>
              <b>{formatKrw(row.point?.totalValueKrw ?? 0)}</b>
            </div>
            <div className="mobileSummaryMeta">
              <span>손익 {compactSignedKrw(row.point?.totalIncomeKrw ?? row.point?.gainKrw ?? 0)}</span>
              <span>현금화 {compactKrw(row.point?.liquidValueKrw ?? 0)}</span>
              <span>제한 {compactKrw(row.point?.lockedValueKrw ?? 0)}</span>
            </div>
            <div className="mobileSummaryAssets">
              <b>해제분 {formatKrw(row.releasedValueKrw)}</b>
              <span>{summaryAssetNames(row.releasedAssets)}</span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function summaryAssetNames(assets: AssetValuation[]) {
  const names = assets.slice(0, 2).map((asset) => asset.name);
  const restCount = Math.max(0, assets.length - names.length);
  return `${names.join(", ")}${restCount ? ` 외 ${restCount}개` : ""}`;
}

function summarizePriceRefreshFailures(
  results: Array<{ ok: boolean; name: string; ticker: string | null; message?: string }>
) {
  const failed = results
    .filter((item) => !item.ok)
    .map((item) => item.ticker || item.name)
    .filter(Boolean);
  if (failed.length === 0) return "";
  return ` (${failed.slice(0, 3).join(", ")}${failed.length > 3 ? ` 외 ${failed.length - 3}개` : ""})`;
}

function summarizePriceHistoryFailures(
  results: Array<{ ticker: string | null; market: AssetMarket; ok: boolean; message?: string }>,
  fxResult: { ok: boolean; count: number; message?: string } | null
) {
  const failed = results
    .filter((item) => !item.ok)
    .map((item) => item.ticker || marketLabels[item.market])
    .filter(Boolean);
  if (fxResult && !fxResult.ok) failed.push("환율");
  if (failed.length === 0) return "";
  return ` (${failed.slice(0, 3).join(", ")}${failed.length > 3 ? ` 외 ${failed.length - 3}개` : ""})`;
}

function SimulationIncomeForm({
  type,
  accounts,
  form,
  isEditing,
  onChange,
  onCancelEdit,
  onSubmit
}: {
  type: SimulationIncomeType;
  accounts: Account[];
  form: SimulationIncomeForm;
  isEditing: boolean;
  onChange: (form: SimulationIncomeForm) => void;
  onCancelEdit: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const isMonthly = type === "monthly";
  const amountKrw = Number(form.amount);
  const account = form.accountId ? accounts.find((item) => item.id === form.accountId) ?? null : null;
  const dateText = isMonthly
    ? form.repeatsIndefinitely
      ? `${form.startDate || "시작일"}부터 계속`
      : `${form.startDate || "시작일"}~${form.endDate || "종료일"}`
    : form.startDate || "입금일";
  const availabilityText =
    form.availability === "immediate"
      ? "즉시 현금화 가능"
      : form.availability === "unlock_date"
        ? `${form.unlockDate || "해제일"} 이후 가능`
        : "기간 내 현금화 불가";

  return (
    <form className="simulationForm" onSubmit={onSubmit}>
      <input
        name={`${type}Name`}
        placeholder={isMonthly ? "수입 이름" : "입금 이름"}
        value={form.name}
        onChange={(event) => onChange({ ...form, name: event.target.value })}
      />
      <input
        name={`${type}Amount`}
        type="number"
        min="0"
        step="1000"
        placeholder="금액"
        value={form.amount}
        onChange={(event) => onChange({ ...form, amount: event.target.value })}
      />
      <label className="dateInput">
        {isMonthly ? "시작일" : "입금일"}
        <input
          name={`${type}StartDate`}
          type="date"
          value={form.startDate}
          onChange={(event) => onChange({ ...form, startDate: event.target.value })}
        />
      </label>
      <select
        name={`${type}Account`}
        value={form.accountId}
        onChange={(event) => onChange({ ...form, accountId: event.target.value })}
      >
        <option value="">계좌 제한 없음</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
            {account.liquidityRestricted && account.liquidityUnlockDate ? ` · ${account.liquidityUnlockDate} 이후` : ""}
          </option>
        ))}
      </select>
      {isMonthly && (
        <>
          <label className="toggleRow">
            계속 반복
            <input
              name={`${type}RepeatsIndefinitely`}
              type="checkbox"
              checked={form.repeatsIndefinitely}
              onChange={(event) => onChange({ ...form, repeatsIndefinitely: event.target.checked })}
            />
          </label>
          {!form.repeatsIndefinitely && (
            <label className="dateInput">
              종료일
              <input
                name="monthlyEndDate"
                type="date"
                value={form.endDate}
                onChange={(event) => onChange({ ...form, endDate: event.target.value })}
              />
            </label>
          )}
        </>
      )}
      <select
        name={`${type}Availability`}
        value={form.availability}
        onChange={(event) => onChange({ ...form, availability: event.target.value as SimulationAvailability })}
      >
        <option value="immediate">즉시 현금화 가능</option>
        <option value="unlock_date">특정 날짜 이후 가능</option>
        <option value="unavailable">기간 내 현금화 불가</option>
      </select>
      {form.availability === "unlock_date" && (
        <label className="dateInput">
          해제일
          <input
            name={`${type}UnlockDate`}
            type="date"
            value={form.unlockDate}
            onChange={(event) => onChange({ ...form, unlockDate: event.target.value })}
          />
        </label>
      )}
      <input
        name={`${type}Note`}
        placeholder="메모"
        value={form.note}
        onChange={(event) => onChange({ ...form, note: event.target.value })}
      />
      <div className="simulationFormPreview">
        <span>반영 미리보기</span>
        <strong>{Number.isFinite(amountKrw) && amountKrw > 0 ? formatKrw(amountKrw) : "금액 입력 필요"}</strong>
        <small>
          {dateText} · {account?.name ?? "계좌 제한 없음"} · {availabilityText}
        </small>
      </div>
      <div className="simulationFormActions">
        {isEditing && (
          <button className="textButton" type="button" onClick={onCancelEdit}>
            취소
          </button>
        )}
        <button type="submit">
          {isEditing ? <Pencil size={17} /> : <Plus size={17} />}
          {isEditing ? "수정" : "추가"}
        </button>
      </div>
    </form>
  );
}

function SimulationIncomeList({
  accountById,
  incomes,
  editingIncomeId,
  onEdit,
  onRemove
}: {
  accountById: Map<string, Account>;
  incomes: SimulationIncome[];
  editingIncomeId: string | null;
  onEdit: (income: SimulationIncome) => void;
  onRemove: (id: string) => void;
}) {
  if (incomes.length === 0) {
    return <span className="emptyText">등록된 예상 수입이 없습니다.</span>;
  }

  return (
    <div className="simulationIncomeList">
      {incomes.map((income) => (
        <article className={editingIncomeId === income.id ? "simulationIncomeItem editing" : "simulationIncomeItem"} key={income.id}>
          <div>
            <strong>{income.name}</strong>
            <span>{simulationIncomeMeta(income, accountById)}</span>
            {income.note && <small>{income.note}</small>}
          </div>
          <b>{formatKrw(income.amountKrw)}</b>
          <div className="simulationIncomeActions">
            <button type="button" onClick={() => onEdit(income)} aria-label={`${income.name} 수정`}>
              <Pencil size={16} />
            </button>
            <button type="button" onClick={() => onRemove(income.id)} aria-label={`${income.name} 삭제`}>
              <Trash2 size={16} />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function AssetFormView({
  accounts,
  assets,
  positions,
  mode,
  form,
  isSaving,
  isSearchingTickers,
  isLoadingFx,
  isAggregateAssetEdit,
  tickerResults,
  onModeChange,
  onChange,
  onSearchTicker,
  onSelectTicker,
  onSubmit
}: {
  accounts: Account[];
  assets: AssetValuation[];
  positions: AssetPosition[];
  mode: TransactionMode;
  form: AssetForm;
  isSaving: boolean;
  isSearchingTickers: boolean;
  isLoadingFx: boolean;
  isAggregateAssetEdit: boolean;
  tickerResults: TickerSearchResult[];
  onModeChange: (mode: TransactionMode) => void;
  onChange: (form: AssetForm) => void;
  onSearchTicker: () => void;
  onSelectTicker: (ticker: TickerSearchResult) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const [assetPickerSearch, setAssetPickerSearch] = useState("");
  const selectedPosition = positions.find((position) => position.positionKey === form.positionKey) ?? null;
  const selectablePositions = positions.filter((position) => {
    const query = normalizeAssetName(assetPickerSearch);
    if (!query) return true;
    return [position.name, position.accountName, position.ticker ?? "", assetLabels[position.type], marketLabels[position.market]]
      .map(normalizeAssetName)
      .some((value) => value.includes(query));
  });
  const estimatedSellGain = mode === "sell" && selectedPosition ? estimateSellGain(selectedPosition, form) : null;
  const estimatedSellRate =
    mode === "sell" && selectedPosition
      ? estimateSellRate(selectedPosition, form)
      : null;
  const estimatedDividend = mode === "dividend" ? toNumberOrNull(form.currentValue) ?? 0 : 0;
  const fxRate = Number(form.fxRateToKrw || selectedPosition?.fxRateToKrw || 1);
  const needsTargetSelection = mode === "buy" ? !form.accountId : !form.positionKey;
  const fxRateLabel = mode === "sell" ? "매도 환율" : mode === "dividend" ? "배당 환율" : "현재 환율";
  const fxRateHelp = isLoadingFx
    ? "환율 자동 조회 중"
    : mode === "sell"
      ? "매도일 기준 자동 반영"
      : mode === "dividend"
        ? "배당일 기준 환율 입력"
        : "매수일/현재 기준 자동 반영";
  const isLinkOnlyEdit = isAggregateAssetEdit && mode === "buy";
  const sellAllQuantity = mode === "sell" ? selectedPosition?.quantity ?? null : null;
  const isSellAllSelected =
    sellAllQuantity !== null && Math.abs((toNumberOrNull(form.quantity) ?? -1) - sellAllQuantity) < 0.000001;
  const canSellAll = sellAllQuantity !== null && sellAllQuantity > 0 && !isLinkOnlyEdit;

  return (
    <form className="assetForm" noValidate onSubmit={onSubmit}>
      {isLinkOnlyEdit && (
        <div className="formNotice">
          합산 자산은 분류, 티커 연동, 매도 제한 정보만 일괄 수정합니다. 수량, 원가, 매수일은 각 거래 lot 값을 유지합니다.
        </div>
      )}
      <section className="formSection">
        <div className="formStepHeader">
          <span>1</span>
          <div>
            <strong>거래 유형</strong>
            <p>매수, 매도, 배당 중 하나를 선택합니다.</p>
          </div>
        </div>
        <div className="transactionMode">
          <Segmented options={editableTransactionLabels} value={mode} onChange={(value) => onModeChange(value as TransactionMode)} />
        </div>
      </section>

      <section className="formSection">
        <div className="formStepHeader">
          <span>2</span>
          <div>
            <strong>대상</strong>
            <p>{mode === "buy" ? "계좌와 새 자산 정보를 입력합니다." : "거래할 보유 자산을 선택합니다."}</p>
          </div>
        </div>
        {mode !== "buy" ? (
          <>
            <input
              className="assetPickerSearch"
              name="assetPickerSearch"
              placeholder="보유 자산 검색"
              value={assetPickerSearch}
              onChange={(event) => setAssetPickerSearch(event.target.value)}
            />
            <select
              className={needsTargetSelection ? "targetSelectWarning" : ""}
              name="positionKey"
              value={form.positionKey}
              onChange={(event) => onChange(formFromSelectedPosition(form, positions, event.target.value))}
            >
              <option value="">보유 자산 선택</option>
              {form.positionKey && !selectedPosition && <option value={form.positionKey}>{form.name || "기존 거래 포지션"}</option>}
              {selectablePositions.map((position) => (
                <option key={position.positionKey} value={position.positionKey}>
                  {position.name} · {position.accountName} · {position.quantity?.toLocaleString("ko-KR") ?? "-"}주 · 평균{" "}
                  {formatNativeAmount(position.averageCost ?? 0, position.currency)}
                </option>
              ))}
            </select>
            {needsTargetSelection && <span className="targetSelectHint">보유 자산을 먼저 선택해 주세요.</span>}
            {selectedPosition && (
              <div className="holdingSnapshot">
                <span>보유 {selectedPosition.quantity?.toLocaleString("ko-KR") ?? "-"}주 · {selectedPosition.lotCount}건 통합</span>
                <span>
                  평균 {formatNativeAmount(selectedPosition.averageCost ?? 0, selectedPosition.currency)} · 현재{" "}
                  {formatNativeAmount(selectedPosition.currentValue ?? 0, selectedPosition.currency)}
                </span>
                <b>평가액 {formatKrw(selectedPosition.valueKrw)}</b>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="formGrid three">
              <select
                className={needsTargetSelection ? "targetSelectWarning" : ""}
                name="accountId"
                value={form.accountId}
                disabled={isLinkOnlyEdit}
                onChange={(event) => onChange({ ...form, accountId: event.target.value })}
              >
                <option value="">계좌 선택</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              <select
                name="assetType"
                value={form.type}
                onChange={(event) => {
                  const type = event.target.value as AssetType;
                  onChange({
                    ...form,
                    type,
                    maturityCurrency: type === "bond" ? form.maturityCurrency || form.currency : form.maturityCurrency
                  });
                }}
              >
                {Object.entries(assetLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                name="market"
                value={form.market}
                onChange={(event) => {
                  const market = event.target.value as AssetMarket;
                  onChange({
                    ...form,
                    market,
                    currency: market === "us" ? "USD" : form.currency === "USD" ? "KRW" : form.currency,
                    maturityCurrency: market === "us" ? "USD" : form.currency === "USD" ? "KRW" : form.maturityCurrency,
                    purchaseFxRateToKrw: market === "us" ? form.purchaseFxRateToKrw : "1",
                    fxRateToKrw: market === "us" ? form.fxRateToKrw : "1",
                    maturityFxRateToKrw: market === "us" ? form.maturityFxRateToKrw : "1"
                  });
                }}
              >
                {Object.entries(marketLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {needsTargetSelection && <span className="targetSelectHint">계좌를 먼저 선택해 주세요.</span>}
            <div className="searchField">
              <input
                name="assetName"
                required
                placeholder="자산명"
                value={form.name}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && form.name.trim().length >= 2 && !isSearchingTickers) {
                    event.preventDefault();
                    onSearchTicker();
                  }
                }}
              />
              <button type="button" onClick={onSearchTicker} disabled={form.name.trim().length < 2 || isSearchingTickers}>
                {isSearchingTickers ? "검색 중" : "검색"}
              </button>
            </div>
            {tickerResults.length > 0 && (
              <div className="tickerResults">
                {tickerResults.map((ticker) => (
                  <button key={`${ticker.symbol}-${ticker.exchange ?? ""}`} type="button" onClick={() => onSelectTicker(ticker)}>
                    <strong>{ticker.symbol}</strong>
                    <span>
                      {ticker.name} · {ticker.exchange ?? marketLabels[ticker.market]} · {ticker.currency}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="formGrid two">
              <input
                name="ticker"
                placeholder="티커 예: AAPL, 005930.KS"
                value={form.ticker}
                onChange={(event) => onChange({ ...form, ticker: event.target.value.toUpperCase() })}
              />
              <input
                name="currency"
                placeholder="통화"
                value={form.currency}
                maxLength={3}
                onChange={(event) => {
                  const currency = event.target.value.toUpperCase();
                  onChange({
                    ...form,
                    currency,
                    maturityCurrency: form.type === "bond" ? currency : form.maturityCurrency
                  });
                }}
              />
            </div>
          </>
        )}
      </section>

      <section className="formSection">
        <div className="formStepHeader">
          <span>3</span>
          <div>
            <strong>금액</strong>
            <p>단가, 수량, 환율 기준을 입력합니다.</p>
          </div>
        </div>
        <div className="priceQuantityGrid">
          {mode === "buy" && (
	            <input
	              inputMode="decimal"
	              name="averageCost"
	              placeholder="평균단가"
	              value={form.averageCost}
	              disabled={isLinkOnlyEdit}
	              onChange={(event) => onChange({ ...form, averageCost: event.target.value })}
	            />
	          )}
          <input
            inputMode="decimal"
            name={mode === "dividend" ? "dividendAmount" : mode === "sell" ? "sellPrice" : "currentValue"}
	            placeholder={mode === "dividend" ? "배당금" : mode === "sell" ? "매도단가" : form.ticker || form.quantity ? "현재가" : "평가액"}
	            value={form.currentValue}
	            disabled={isLinkOnlyEdit}
	            onChange={(event) => onChange({ ...form, currentValue: event.target.value })}
	          />
          {mode !== "dividend" && (
            mode === "sell" ? (
              <div className="sellQuantityControl">
                <input
                  inputMode="decimal"
                  name="quantity"
                  placeholder="수량"
                  max={selectedPosition?.quantity ?? undefined}
                  value={form.quantity}
                  disabled={isLinkOnlyEdit}
                  onChange={(event) => onChange({ ...form, quantity: event.target.value })}
                />
                <button
                  className={isSellAllSelected ? "active" : ""}
                  type="button"
                  aria-pressed={isSellAllSelected}
                  disabled={!canSellAll}
                  title="보유 수량 전체를 매도 수량으로 입력"
                  onClick={() => {
                    if (sellAllQuantity !== null) {
                      onChange({ ...form, quantity: quantityInputValue(sellAllQuantity) });
                    }
                  }}
                >
                  전량 매도
                </button>
              </div>
            ) : (
              <input
                inputMode="decimal"
                name="quantity"
                placeholder="수량"
                value={form.quantity}
                disabled={isLinkOnlyEdit}
                onChange={(event) => onChange({ ...form, quantity: event.target.value })}
              />
            )
          )}
        </div>
        {form.currency === "USD" || form.market === "us" ? (
          <div className="fxGrid">
            <label>
              매수 환율
              <input
                inputMode="decimal"
                name="purchaseFxRateToKrw"
                value={form.purchaseFxRateToKrw}
                onChange={(event) => onChange({ ...form, purchaseFxRateToKrw: event.target.value })}
              />
            </label>
            <label>
              {fxRateLabel}
              <input
                inputMode="decimal"
                name="fxRateToKrw"
                value={form.fxRateToKrw}
                onChange={(event) => onChange({ ...form, fxRateToKrw: event.target.value })}
              />
            </label>
            <span>{fxRateHelp}</span>
          </div>
        ) : form.currency !== "KRW" || form.market === "other" ? (
          <input
            inputMode="decimal"
            name="fxRateToKrw"
            placeholder="원화 환율"
            value={form.fxRateToKrw}
            onChange={(event) => onChange({ ...form, fxRateToKrw: event.target.value })}
          />
        ) : null}
      </section>

      <section className="formSection">
        <div className="formStepHeader">
          <span>4</span>
          <div>
            <strong>조건</strong>
            <p>거래일, 매도 제한, 만기, 메모를 정리합니다.</p>
          </div>
        </div>
        <label className="dateInput">
          {mode === "sell" ? "매도일" : mode === "dividend" ? "배당일" : "매수일"}
          <input
            name="valuationDate"
	            type="date"
	            value={form.valuationDate}
	            disabled={isLinkOnlyEdit}
	            onChange={(event) => onChange({ ...form, valuationDate: event.target.value })}
	          />
        </label>
        {mode === "buy" && (
          <>
            <label className="toggleRow">
              <input
	                type="checkbox"
	                name="isSaleRestricted"
	                checked={form.isSaleRestricted}
	                onChange={(event) =>
                  onChange({
                    ...form,
                    isSaleRestricted: event.target.checked,
                    liquidFrom: event.target.checked ? form.liquidFrom : form.valuationDate
                  })
                }
              />
              <span>매도 제한</span>
            </label>
            {form.isSaleRestricted && (
              <label className="dateInput">
                매도 가능일
                <input
                  name="liquidFrom"
                  type="date"
                  value={form.liquidFrom}
                  onChange={(event) => onChange({ ...form, liquidFrom: event.target.value })}
                />
              </label>
            )}
            {form.type === "bond" && (
              <div className="maturityPanel">
                <label className="toggleRow">
                  <input
                    type="checkbox"
                    name="autoConvertOnMaturity"
                    checked={form.autoConvertOnMaturity}
                    onChange={(event) => onChange({ ...form, autoConvertOnMaturity: event.target.checked })}
                  />
                  <span>만기 자동 현금 전환</span>
                </label>
                <label className="dateInput">
                  만기일
                  <input
                    name="maturityDate"
                    type="date"
                    value={form.maturityDate}
                    onChange={(event) => onChange({ ...form, maturityDate: event.target.value })}
                  />
                </label>
                <div className="priceQuantityGrid">
                  <input
                    inputMode="decimal"
                    name="maturityAmount"
                    placeholder="만기 상환금액"
                    value={form.maturityAmount}
                    onChange={(event) => onChange({ ...form, maturityAmount: event.target.value })}
                  />
                  <input
                    name="maturityCurrency"
                    placeholder="상환 통화"
                    maxLength={3}
                    value={form.maturityCurrency}
                    onChange={(event) => onChange({ ...form, maturityCurrency: event.target.value.toUpperCase() })}
                  />
                  <input
                    inputMode="decimal"
                    name="maturityFxRateToKrw"
                    placeholder="상환 환율"
                    value={form.maturityFxRateToKrw}
                    onChange={(event) => onChange({ ...form, maturityFxRateToKrw: event.target.value })}
                  />
                </div>
                <div className="tradePreview compact">
                  <span>예상 만기 상환 {formatNativeAmount(toNumberOrNull(form.maturityAmount) ?? 0, form.maturityCurrency || form.currency)}</span>
                  <b className={gainClass(estimateMaturityGain(form))}>예상 확정손익 {formatSignedKrw(estimateMaturityGain(form))}</b>
                </div>
              </div>
            )}
          </>
        )}
        <textarea
          name="notes"
          placeholder="메모"
          value={form.notes}
          disabled={isLinkOnlyEdit}
          onChange={(event) => onChange({ ...form, notes: event.target.value })}
        />
      </section>

      <TradeSaveSummary
        mode={mode}
        form={form}
        selectedPosition={selectedPosition}
        estimatedSellGain={estimatedSellGain}
        estimatedSellRate={estimatedSellRate}
        estimatedDividendKrw={estimatedDividend * fxRate}
      />
      <button type="submit" disabled={!accounts.length || isSaving}>
        <Plus size={18} />
        {isSaving ? "저장 중" : `${transactionLabels[mode]} 저장`}
      </button>
    </form>
  );
}

function AssetList({
  assets,
  showKrwForUsd,
  onEdit,
  onDelete
}: {
  assets: AssetValuation[];
  showKrwForUsd: boolean;
  onEdit: (asset: AssetValuation) => void;
  onDelete: (asset: AssetValuation) => void;
}) {
  if (assets.length === 0) {
    return <span className="emptyText">등록된 자산 없음</span>;
  }

  return (
    <div className="assetList">
      {assets.map((asset) => {
        const display = assetDisplayValue(asset, showKrwForUsd);
        const lotCount = asset.lotCount ?? 1;
        const canModify = lotCount === 1;

        return (
          <article className={asset.isLiquidByDate ? "assetItem liquid" : "assetItem"} key={asset.id}>
            <div className="assetMain">
              <div>
                <strong>{asset.name}</strong>
                <span>
                  {asset.accountName} · {assetLabels[asset.type]} · {marketLabels[asset.market]}
                  {asset.ticker ? ` · ${asset.ticker}` : ""}
                </span>
              </div>
              <div className="assetValue">
                <b>{display.value}</b>
                <span className={gainClass(display.gainValue)}>
                  {display.gain} · {formatPercent(display.gainRate)}
                </span>
              </div>
            </div>
            <div className="assetMeta">
              <span>
                {asset.currency}
                {asset.quantity !== null ? ` · ${asset.quantity.toLocaleString("ko-KR")}주` : ""}
                {asset.averageCost !== null ? ` · 평균단가 ${formatNativeAmount(asset.averageCost, asset.currency)}` : ""}
                {asset.currency !== "KRW"
                  ? ` · 매수환율 ${asset.purchaseFxRateToKrw.toLocaleString("ko-KR")} · 현재환율 ${asset.fxRateToKrw.toLocaleString("ko-KR")}`
                  : ""}
              </span>
              <span>{formatAssetDateMeta(asset)}</span>
              {asset.accountLiquidityRestricted && (
                <span className="accountRestrictionBadge">
                  계좌 제한{asset.accountLiquidityUnlockDate ? ` ${asset.accountLiquidityUnlockDate} 이후` : ""}
                </span>
              )}
              {asset.type === "bond" && asset.maturityDate && <span>{formatBondMaturityMeta(asset)}</span>}
              <span>{priceSourceLabel(asset.priceSource)}</span>
              {asset.lastPriceError && <span className="errorText">{asset.lastPriceError}</span>}
            </div>
            <div className="rowActions">
              <button type="button" onClick={() => onEdit(asset)} aria-label={`${asset.name} 수정`}>
                <Pencil size={16} />
              </button>
              {canModify ? (
                <button type="button" onClick={() => onDelete(asset)} aria-label={`${asset.name} 삭제`}>
                  <Trash2 size={16} />
                </button>
              ) : (
                <span className="aggregateBadge">{lotCount}건 합산 · 티커 연동</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function TransactionList({
  transactions,
  onEdit,
  onDelete
}: {
  transactions: AssetTransaction[];
  onEdit: (transaction: AssetTransaction) => void;
  onDelete: (transaction: AssetTransaction) => void;
}) {
  const [transactionFilter, setTransactionFilter] = useState<"all" | TransactionType>("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [visibleTransactionCount, setVisibleTransactionCount] = useState(transactionListPageSize);

  useEffect(() => {
    setVisibleTransactionCount(transactionListPageSize);
  }, [accountFilter, transactionFilter, transactions]);

  if (transactions.length === 0) {
    return <span className="emptyText">거래 이력이 없습니다.</span>;
  }

  const accountOptions = Array.from(
    transactions.reduce<Map<string, string>>((acc, transaction) => {
      acc.set(transaction.accountId, transaction.accountName);
      return acc;
    }, new Map())
  )
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
  const accountFilteredTransactions =
    accountFilter === "all" ? transactions : transactions.filter((transaction) => transaction.accountId === accountFilter);

  const counts = accountFilteredTransactions.reduce(
    (acc, transaction) => {
      acc[transaction.transactionType] = (acc[transaction.transactionType] ?? 0) + 1;
      return acc;
    },
    {} as Record<TransactionType, number>
  );
  const allFilterOptions: Array<{ key: "all" | TransactionType; label: string; count: number }> = [
    { key: "all", label: "전체", count: accountFilteredTransactions.length },
    { key: "buy", label: "매수", count: counts.buy ?? 0 },
    { key: "sell", label: "매도", count: counts.sell ?? 0 },
    { key: "dividend", label: "배당", count: counts.dividend ?? 0 },
    { key: "deposit", label: "입금", count: counts.deposit ?? 0 }
  ];
  const filterOptions = allFilterOptions.filter(
    (option) => option.key !== "deposit" || option.count > 0 || transactionFilter === "deposit"
  );
  const filteredTransactions =
    transactionFilter === "all"
      ? accountFilteredTransactions
      : accountFilteredTransactions.filter((transaction) => transaction.transactionType === transactionFilter);
  const visibleTransactions = filteredTransactions.slice(0, visibleTransactionCount);
  const remainingTransactionCount = filteredTransactions.length - visibleTransactions.length;

  return (
    <>
      <div className="transactionFilters">
        <div className="transactionSummary" role="group" aria-label="거래 유형 필터">
          {filterOptions.map((option) => (
            <button
              className={transactionFilter === option.key ? "active" : ""}
              type="button"
              key={option.key}
              onClick={() => setTransactionFilter(option.key)}
              aria-pressed={transactionFilter === option.key}
            >
              {option.label} {option.count.toLocaleString("ko-KR")}건
            </button>
          ))}
        </div>
        <label className="transactionAccountFilter">
          <span>계좌</span>
          <select name="transactionAccountFilter" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
            <option value="all">전체 계좌</option>
            {accountOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="transactionList">
        {filteredTransactions.length === 0 && <span className="emptyText">선택한 조건의 거래가 없습니다.</span>}
        {visibleTransactions.map((transaction) => {
          const income = transaction.transactionType === "dividend" ? transaction.dividendIncomeKrw : transaction.realizedGainKrw;
          const displayAmount =
            transaction.transactionType === "buy" || transaction.transactionType === "deposit"
              ? formatKrw((transaction.amount ?? 0) * transaction.fxRateToKrw)
              : formatSignedKrw(income);
          const assetName = transaction.assetName ?? (transaction.transactionType === "deposit" ? "현금" : "자산");
          const isZeroTrade = isZeroQuantityTrade(transaction);
          return (
            <article className={isZeroTrade ? "transactionItem warning" : "transactionItem"} key={transaction.id}>
              <div>
                <strong>
                  {transactionLabels[transaction.transactionType]} · {assetName}
                  {isZeroTrade && <em className="transactionWarningBadge">0주 거래 · 삭제 필요</em>}
                </strong>
                <span>
                  {transaction.transactionDate} · {transaction.accountName}
                  {transaction.quantity !== null ? ` · ${transaction.quantity.toLocaleString("ko-KR")}주` : ""}
                </span>
              </div>
              <b className={gainClass(income)}>{displayAmount}</b>
              <div className="rowActions">
                {transaction.transactionType !== "maturity" && transaction.transactionType !== "deposit" && (
                  <button type="button" onClick={() => onEdit(transaction)} aria-label="거래 수정">
                    <Pencil size={15} />
                  </button>
                )}
                <button type="button" onClick={() => onDelete(transaction)} aria-label="거래 삭제">
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          );
        })}
        {remainingTransactionCount > 0 && (
          <button
            className="transactionMoreButton"
            type="button"
            onClick={() => setVisibleTransactionCount((count) => count + transactionListPageSize)}
          >
            더 보기 {Math.min(transactionListPageSize, remainingTransactionCount).toLocaleString("ko-KR")}건 · 남은 거래{" "}
            {remainingTransactionCount.toLocaleString("ko-KR")}건
          </button>
        )}
      </div>
    </>
  );
}

function isZeroQuantityTrade(transaction: AssetTransaction) {
  return (transaction.transactionType === "buy" || transaction.transactionType === "sell") && transaction.quantity === 0;
}

function historyPointsForRange(points: HistoryPoint[], targetDate: string, range: string) {
  if (range === "all") return points;

  const days = historyRangeDays(range);
  const startDate = shiftDate(targetDate, -(days - 1));
  return points.filter((point) => point.date >= startDate && point.date <= targetDate);
}

function historyRangeDays(range: string) {
  switch (range) {
    case "1w":
      return 7;
    case "3m":
      return 90;
    case "6m":
      return 180;
    case "1y":
      return 365;
    case "1m":
    default:
      return 30;
  }
}

const TimelineChart = memo(function TimelineChart({ points, isUpdating = false }: { points: HistoryPoint[]; isUpdating?: boolean }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const width = 340;
  const height = 170;
  const leftPadding = 46;
  const rightPadding = 14;
  const topPadding = 16;
  const bottomPadding = 24;
  const chartBottom = height - bottomPadding;
  const chartData = useMemo(() => {
    const rawMaxValue = Math.max(1, ...points.flatMap((point) => [point.totalValueKrw, point.liquidValueKrw]));
    const yTicks = chartYAxisTicks(rawMaxValue);
    const maxValue = yTicks[yTicks.length - 1]?.value ?? rawMaxValue;
    const xStep = points.length > 1 ? (width - leftPadding - rightPadding) / (points.length - 1) : 0;
    const toX = (index: number) => (points.length > 1 ? leftPadding + index * xStep : (leftPadding + width - rightPadding) / 2);
    const toY = (value: number) => chartBottom - (value / maxValue) * (chartBottom - topPadding);
    const totalPoints = points.map((point, index) => [toX(index), toY(point.totalValueKrw)]);
    const liquidPoints = points.map((point, index) => [toX(index), toY(point.liquidValueKrw)]);

    return {
      yTicks,
      xStep,
      toX,
      toY,
      totalLine: totalPoints.map(([x, y]) => `${x},${y}`).join(" "),
      liquidLine: liquidPoints.map(([x, y]) => `${x},${y}`).join(" "),
      totalArea: areaPoints(totalPoints, chartBottom),
      liquidArea: areaPoints(liquidPoints, chartBottom),
      latest: points[points.length - 1],
      axisPoints: chartAxisPoints(points)
    };
  }, [chartBottom, leftPadding, rightPadding, topPadding, width, points]);
  const { yTicks, xStep, toX, toY, totalLine, liquidLine, totalArea, liquidArea, latest, axisPoints } = chartData;
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const activeX = activeIndex === null ? 0 : toX(activeIndex);
  const labelX = activeX > width / 2 ? activeX - 120 : activeX + 8;
  const markerIndexes = useMemo(() => visibleTimelineMarkerIndexes(points.length, activeIndex), [points.length, activeIndex]);

  useEffect(() => {
    setActiveIndex((current) => (current !== null && current >= points.length ? null : current));
  }, [points.length]);

  function moveActivePoint(delta: number) {
    setActiveIndex((current) => {
      if (points.length === 0) return null;
      const baseIndex = current ?? (delta > 0 ? -1 : points.length);
      return Math.max(0, Math.min(points.length - 1, baseIndex + delta));
    });
  }

  function handleChartKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    moveActivePoint(event.key === "ArrowRight" ? 1 : -1);
  }

  function selectPoint(event: PointerEvent<SVGSVGElement>, shouldFocus = false) {
    if (points.length === 0) return;
    if (shouldFocus) chartRef.current?.focus({ preventScroll: true });
    const rect = event.currentTarget.getBoundingClientRect();
    const chartRight = width - rightPadding;
    const x = Math.max(leftPadding, Math.min(chartRight, ((event.clientX - rect.left) / rect.width) * width));
    const index = points.length > 1 ? Math.round((x - leftPadding) / (xStep || 1)) : 0;
    setActiveIndex(Math.max(0, Math.min(points.length - 1, index)));
  }

  if (points.length === 0) {
    return (
      <div className="chartWrap chartWrapEmpty" aria-busy={isUpdating}>
        <span className="emptyText">{isUpdating ? "추이 데이터를 불러오는 중입니다." : "표시할 추이 데이터가 없습니다."}</span>
      </div>
    );
  }

  return (
    <div
      ref={chartRef}
      className={`chartWrap${isUpdating ? " isUpdating" : ""}`}
      aria-busy={isUpdating}
      aria-label="자산 추이 그래프. 좌우 화살표로 선택 시점을 이동할 수 있습니다."
      onBlur={() => setActiveIndex(null)}
      onKeyDown={handleChartKeyDown}
      role="group"
      tabIndex={0}
    >
      {isUpdating && <span className="chartUpdateBadge">업데이트 중</span>}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="자산 추이 그래프"
        onPointerDown={(event) => selectPoint(event, true)}
        onPointerMove={(event) => {
          if (event.buttons > 0 || event.pointerType === "touch") selectPoint(event);
        }}
        onPointerLeave={() => {
          if (document.activeElement !== chartRef.current) setActiveIndex(null);
        }}
      >
        <defs>
          <linearGradient id="totalAreaGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#17456b" stopOpacity="0.13" />
            <stop offset="100%" stopColor="#17456b" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="liquidAreaGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#28715b" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#28715b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="chartGrid">
          {yTicks.map((tick, index) => (
            <g className="chartYAxisTick" key={`${tick.value}-${index}`}>
              <line x1={leftPadding} x2={width - rightPadding} y1={toY(tick.value)} y2={toY(tick.value)} />
              <text x="4" y={toY(tick.value)} dominantBaseline="middle">
                {formatAxisKrw(tick.value)}
              </text>
            </g>
          ))}
        </g>
        {points.length > 1 && <polygon points={totalArea} className="totalArea" />}
        {points.length > 1 && <polygon points={liquidArea} className="liquidArea" />}
        <polyline points={totalLine} className="totalLine" vectorEffect="non-scaling-stroke" />
        <polyline points={liquidLine} className="liquidLine" vectorEffect="non-scaling-stroke" />
        {markerIndexes.map((index) => {
          const point = points[index];
          return <circle className="chartMarker" key={point.date} cx={toX(index)} cy={toY(point.liquidValueKrw)} r="1.7" />;
        })}
        {activePoint && (
          <g className="chartTooltip">
            <line x1={activeX} x2={activeX} y1={topPadding} y2={chartBottom} vectorEffect="non-scaling-stroke" />
            <circle className="activeTotalPoint" cx={activeX} cy={toY(activePoint.totalValueKrw)} r="4.2" />
            <circle className="activeLiquidPoint" cx={activeX} cy={toY(activePoint.liquidValueKrw)} r="4.2" />
            <rect x={labelX} y="12" width="112" height="72" rx="8" />
            <text className="tooltipDate" x={labelX + 9} y="29">
              {formatDisplayDate(activePoint.date)}
            </text>
            <text x={labelX + 9} y="47">
              전체 {compactKrw(activePoint.totalValueKrw)}
            </text>
            <text x={labelX + 9} y="62">
              현금화 {compactKrw(activePoint.liquidValueKrw)}
            </text>
            <text x={labelX + 9} y="77">
              수익 {compactSignedKrw(activePoint.totalIncomeKrw ?? activePoint.gainKrw)}
            </text>
          </g>
        )}
      </svg>
      <div className="chartAxis">
        {axisPoints.map((point) => (
          <span key={`${point.date}-${point.align}`} className={point.align}>
            {formatDisplayDate(point.date)}
          </span>
        ))}
      </div>
      <div className="chartLegend">
        <span>
          <i className="legendTotal" /> 전체 {compactKrw(latest?.totalValueKrw ?? 0)}
        </span>
        <span>
          <i className="legendLiquid" /> 현금화 {compactKrw(latest?.liquidValueKrw ?? 0)}
        </span>
        <span>
          수익 {compactSignedKrw(latest?.totalIncomeKrw ?? latest?.gainKrw ?? 0)}
        </span>
      </div>
    </div>
  );
});

function chartAxisPoints(points: Array<{ date: string }>) {
  if (points.length === 0) {
    return [];
  }

  const middleIndex = Math.floor((points.length - 1) / 2);
  return [
    { date: points[0].date, align: "start" },
    { date: points[middleIndex].date, align: "middle" },
    { date: points[points.length - 1].date, align: "end" }
  ].filter((point, index, all) => all.findIndex((item) => item.date === point.date) === index);
}

function chartYAxisTicks(maxValue: number, count = 5) {
  const tickCount = Math.max(2, count);
  const safeMax = Math.max(1, maxValue);
  const roughStep = safeMax / (tickCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / magnitude;
  const multiplier = normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 2.5 ? 2.5 : normalizedStep <= 5 ? 5 : 10;
  const step = multiplier * magnitude;

  return Array.from({ length: tickCount }, (_, index) => ({
    value: step * index
  }));
}

function visibleTimelineMarkerIndexes(length: number, activeIndex: number | null) {
  if (length <= 30) {
    return Array.from({ length }, (_, index) => index);
  }

  const indexes = new Set<number>();
  if (length <= 120) {
    const step = Math.ceil(length / 30);
    for (let index = 0; index < length; index += step) {
      indexes.add(index);
    }
  }

  indexes.add(0);
  indexes.add(length - 1);
  if (activeIndex !== null) indexes.add(activeIndex);

  return [...indexes].sort((a, b) => a - b);
}

function areaPoints(points: number[][], bottomY: number) {
  if (points.length === 0) return "";

  const first = points[0];
  const last = points[points.length - 1];
  return [`${first[0]},${bottomY}`, ...points.map(([x, y]) => `${x},${y}`), `${last[0]},${bottomY}`].join(" ");
}

function AllocationPie({
  items,
  labels = {},
  activeCategory,
  activeDetails,
  activeCategoryLabel,
  onToggle
}: {
  items: BreakdownItem[];
  labels?: Record<string, string>;
  activeCategory: string | null;
  activeDetails: AssetDetailItem[];
  activeCategoryLabel: string | null;
  onToggle: (category: string) => void;
}) {
  const visibleItems = items.filter((item) => item.valueKrw > 0);
  const total = visibleItems.reduce((sum, item) => sum + item.valueKrw, 0);
  let offset = 25;

  if (visibleItems.length === 0 || total <= 0) {
    return <span className="emptyText">등록된 자산 없음</span>;
  }

  return (
    <div className="pieBlock">
      <svg viewBox="0 0 120 120" className="pieChart" role="img" aria-label="자산 점유율 파이차트">
        <circle className="pieBase" cx="60" cy="60" r="42" />
        {visibleItems.map((item, index) => {
          const length = (item.valueKrw / total) * 263.89;
          const color = allocationColors[index % allocationColors.length];
          const circle = (
            <circle
              aria-label={`${labels[item.key] ?? item.label} ${formatPercent(item.share)}`}
              aria-pressed={activeCategory === item.key}
              className={activeCategory === item.key ? "pieSlice active" : "pieSlice"}
              key={item.key}
              role="button"
              tabIndex={0}
              cx="60"
              cy="60"
              r="42"
              stroke={color}
              strokeDasharray={`${length} ${263.89 - length}`}
              strokeDashoffset={offset}
              onClick={() => onToggle(item.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggle(item.key);
                }
              }}
            />
          );
          offset -= length;
          return circle;
        })}
        <text x="60" y="57" textAnchor="middle">
          전체
        </text>
        <text x="60" y="73" textAnchor="middle">
          {compactKrw(total)}
        </text>
      </svg>
      {activeCategory && <AllocationSubPie details={activeDetails} categoryLabel={activeCategoryLabel ?? "선택 분류"} />}
    </div>
  );
}

function AllocationAnalysis({
  items,
  assets,
  labels = {}
}: {
  items: BreakdownItem[];
  assets: AssetValuation[];
  labels?: Record<string, string>;
}) {
  const [activeBreakdownCategory, setActiveBreakdownCategory] = useState<string | null>(null);
  const visibleItems = items.filter((item) => item.valueKrw > 0);
  const activeItem = visibleItems.find((item) => item.key === activeBreakdownCategory) ?? null;
  const activeDetails = activeItem ? categoryAssetDetails(assets, activeItem.key, activeItem.valueKrw) : [];
  const activeCategoryLabel = activeItem ? labels[activeItem.key] ?? activeItem.label : null;
  const toggleBreakdownCategory = (category: string) =>
    setActiveBreakdownCategory((current) => (current === category ? null : category));

  if (items.length === 0) {
    return <span className="emptyText">등록된 자산 없음</span>;
  }

  return (
    <div className="allocationAnalysis">
      <AllocationPie
        items={visibleItems}
        labels={labels}
        activeCategory={activeBreakdownCategory}
        activeDetails={activeDetails}
        activeCategoryLabel={activeCategoryLabel}
        onToggle={toggleBreakdownCategory}
      />
      <div className="allocationBreakdownList">
        {visibleItems.map((item, index) => {
          const color = allocationColors[index % allocationColors.length];
          const isActive = activeBreakdownCategory === item.key;
          const details = isActive ? activeDetails : [];

          return (
            <div className={isActive ? "allocationBreakdownItem active" : "allocationBreakdownItem"} key={item.key}>
              <button
                type="button"
                aria-expanded={isActive}
                onClick={() => toggleBreakdownCategory(item.key)}
              >
                <span className="allocationName">
                  <i style={{ background: color }} />
                  <strong>{labels[item.key] ?? item.label}</strong>
                </span>
                <span className="allocationAmount">{formatKrw(item.valueKrw)}</span>
                <b>{formatPercent(item.share)}</b>
                <span className="allocationBar" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, item.share)}%`, background: color }} />
                </span>
              </button>
              {isActive && (
                <AllocationDetailList
                  details={details}
                  groupShareLabel="분류 내"
                  variant="compact"
                  amountFormatter={formatKrwThousands}
                  signedAmountFormatter={formatSignedKrwThousands}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AllocationDetailList({
  details,
  groupShareLabel,
  variant = "full",
  amountFormatter = formatKrw,
  signedAmountFormatter = formatSignedKrw
}: {
  details: AssetDetailItem[];
  groupShareLabel: string;
  variant?: "full" | "compact";
  amountFormatter?: (value: number) => string;
  signedAmountFormatter?: (value: number) => string;
}) {
  if (details.length === 0) {
    return <span className="allocationDetailEmpty">세부 자산 없음</span>;
  }

  return (
    <div className="allocationDetails">
      {details.map((detail) => {
        const rowContent =
          variant === "compact" ? (
            <>
              <span className="allocationDetailMain">
                <strong>{detail.name}</strong>
                <span className={gainClass(detail.gainKrw)}>{signedAmountFormatter(detail.gainKrw)}</span>
              </span>
              <span className="allocationDetailStats compact">
                <span className="allocationValueStat">
                  <em>평가금</em>
                  <b>{amountFormatter(detail.valueKrw)}</b>
                </span>
                <span>
                  <em>수익률</em>
                  <b className={gainClass(detail.gainKrw)}>{formatPercent(detail.gainRate)}</b>
                </span>
              </span>
            </>
          ) : (
            <>
              <span className="allocationDetailMain">
                <strong>{detail.name}</strong>
                <span>
                  {groupShareLabel} {formatPercent(detail.groupShare)} · 전체 {formatPercent(detail.totalShare)}
                </span>
              </span>
              <span className="allocationDetailStats">
                <span>
                  <em>원금</em>
                  <b>{amountFormatter(detail.costKrw)}</b>
                </span>
                <span>
                  <em>평가</em>
                  <b>{amountFormatter(detail.valueKrw)}</b>
                </span>
                <span>
                  <em>손익</em>
                  <b className={gainClass(detail.gainKrw)}>{signedAmountFormatter(detail.gainKrw)}</b>
                </span>
                <span>
                  <em>수익률</em>
                  <b className={gainClass(detail.gainKrw)}>{formatPercent(detail.gainRate)}</b>
                </span>
              </span>
            </>
          );

        return (
          <div className="allocationDetailRow" key={detail.key}>
            {rowContent}
          </div>
        );
      })}
    </div>
  );
}

function AllocationSubPie({ details, categoryLabel }: { details: AssetDetailItem[]; categoryLabel: string }) {
  const slices = allocationSubPieSlices(details);
  const total = slices.reduce((sum, slice) => sum + slice.valueKrw, 0);
  const circumference = 201.06;
  let offset = 25;

  return (
    <div className="allocationSubChart">
      <div className="allocationSubHeader">
        <strong>{categoryLabel} 구성</strong>
        <span>분류 내 비중</span>
      </div>
      {slices.length === 0 || total <= 0 ? (
        <span className="allocationDetailEmpty">세부 자산 없음</span>
      ) : (
        <div className="allocationSubBody">
          <svg viewBox="0 0 96 96" className="subPieChart" role="img" aria-label={`${categoryLabel} 종목 구성 파이차트`}>
            <circle className="pieBase" cx="48" cy="48" r="32" />
            {slices.map((slice) => {
              const length = (slice.valueKrw / total) * circumference;
              const circle = (
                <circle
                  aria-label={`${slice.label} ${formatPercent(slice.share)}`}
                  className="subPieSlice"
                  key={slice.key}
                  cx="48"
                  cy="48"
                  r="32"
                  stroke={slice.color}
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={offset}
                />
              );
              offset -= length;
              return circle;
            })}
            <text x="48" y="45" textAnchor="middle">
              구성
            </text>
            <text x="48" y="59" textAnchor="middle">
              {slices.length}개
            </text>
          </svg>
          <div className="allocationSubLegend">
            {slices.map((slice) => (
              <div key={slice.key}>
                <span>
                  <i style={{ background: slice.color }} />
                  <strong>{slice.label}</strong>
                </span>
                <b>{formatPercent(slice.share)}</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function allocationSubPieSlices(details: AssetDetailItem[]) {
  const visibleDetails = details.filter((detail) => detail.valueKrw > 0);
  const totalValueKrw = visibleDetails.reduce((sum, detail) => sum + detail.valueKrw, 0);
  if (totalValueKrw <= 0) return [];

  const topDetails = visibleDetails.slice(0, 4);
  const otherDetails = visibleDetails.slice(4);
  const rows = topDetails.map((detail, index) => ({
    key: detail.key,
    label: detail.name,
    valueKrw: detail.valueKrw,
    share: roundNumber((detail.valueKrw / totalValueKrw) * 100, 1),
    color: allocationColors[index % allocationColors.length]
  }));
  const otherValueKrw = otherDetails.reduce((sum, detail) => sum + detail.valueKrw, 0);

  if (otherValueKrw > 0) {
    rows.push({
      key: "other",
      label: "기타",
      valueKrw: otherValueKrw,
      share: roundNumber((otherValueKrw / totalValueKrw) * 100, 1),
      color: allocationColors[rows.length % allocationColors.length]
    });
  }

  return rows;
}

type AssetDetailItem = {
  key: string;
  name: string;
  costKrw: number;
  valueKrw: number;
  gainKrw: number;
  gainRate: number | null;
  groupShare: number | null;
  totalShare: number | null;
};

function categoryAssetDetails(assets: AssetValuation[], category: string, categoryValueKrw: number) {
  const totalValueKrw = assets.reduce((sum, asset) => sum + Math.max(0, asset.valueKrw), 0);
  return assetDetailItems(
    assets.filter((asset) => asset.type === category && asset.valueKrw > 0),
    categoryValueKrw,
    totalValueKrw
  );
}

function accountAssetDetails(assets: AssetValuation[], accountId: string) {
  const accountAssets = assets.filter((asset) => (asset.accountId === accountId || asset.accountName === accountId) && asset.valueKrw > 0);
  const accountValueKrw = accountAssets.reduce((sum, asset) => sum + asset.valueKrw, 0);
  const totalValueKrw = assets.reduce((sum, asset) => sum + Math.max(0, asset.valueKrw), 0);
  return assetDetailItems(accountAssets, accountValueKrw, totalValueKrw);
}

function assetDetailItems(assets: AssetValuation[], groupValueKrw: number, totalValueKrw: number) {
  const grouped = assets.reduce<Map<string, AssetValuation[]>>((groups, asset) => {
    const key = assetDetailAggregationKey(asset);
    groups.set(key, [...(groups.get(key) ?? []), asset]);
    return groups;
  }, new Map());

  return Array.from(grouped.entries())
    .map(([key, group]) => {
      const asset = aggregateAssetGroup(group);
      return {
        key,
        name: asset.name,
        costKrw: asset.costKrw,
        valueKrw: asset.valueKrw,
        gainKrw: asset.gainKrw,
        gainRate: asset.gainRate,
        groupShare: groupValueKrw > 0 ? roundNumber((asset.valueKrw / groupValueKrw) * 100, 1) : null,
        totalShare: totalValueKrw > 0 ? roundNumber((asset.valueKrw / totalValueKrw) * 100, 1) : null
      };
    })
    .sort((a, b) => b.valueKrw - a.valueKrw);
}

function performanceRows(assets: AssetValuation[], direction: "top" | "bottom"): PerformanceRow[] {
  const rows = assetDetailItems(
    assets.filter((asset) => asset.valueKrw > 0 && asset.costKrw > 0),
    assets.reduce((sum, asset) => sum + Math.max(0, asset.valueKrw), 0),
    assets.reduce((sum, asset) => sum + Math.max(0, asset.valueKrw), 0)
  ).filter((asset) => asset.gainRate !== null);

  return rows
    .sort((a, b) => (direction === "top" ? (b.gainRate ?? 0) - (a.gainRate ?? 0) : (a.gainRate ?? 0) - (b.gainRate ?? 0)))
    .slice(0, 3)
    .map((asset) => ({
      key: asset.key,
      label: asset.name,
      valueKrw: asset.valueKrw,
      gainKrw: asset.gainKrw,
      gainRate: asset.gainRate
    }));
}

function previousHistoryPoint(points: HistoryPoint[], targetDate: string) {
  return [...points]
    .filter((point) => point.date < targetDate)
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

function historyPointOnOrBefore(points: HistoryPoint[], targetDate: string) {
  return [...points]
    .filter((point) => point.date <= targetDate)
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

function dashboardPeriodRows(summary: Summary, points: HistoryPoint[], targetDate: string) {
  const targets = [
    { label: "현재", date: targetDate },
    { label: "1개월 전", date: shiftDate(targetDate, -30) },
    { label: "3개월 전", date: shiftDate(targetDate, -90) },
    { label: "1년 전", date: shiftDate(targetDate, -365) },
    { label: "전체 시작", date: points[0]?.date ?? "" }
  ];

  return targets.map((target) => {
    if (target.label === "현재") {
      return {
        label: target.label,
        date: targetDate,
        valueKrw: summary.totalValueKrw,
        deltaKrw: 0
      };
    }

    const point = target.date ? historyPointOnOrBefore(points, target.date) : null;
    return {
      label: target.label,
      date: point?.date ?? null,
      valueKrw: point?.totalValueKrw ?? null,
      deltaKrw: point ? summary.totalValueKrw - point.totalValueKrw : null
    };
  });
}

function dashboardIncomePeriodRows(summary: Summary, points: HistoryPoint[], targetDate: string): DashboardIncomePeriodRow[] {
  const targets = [
    { label: "1년", date: shiftDate(targetDate, -365) },
    { label: "3개월", date: shiftDate(targetDate, -90) },
    { label: "1개월", date: shiftDate(targetDate, -30) },
    { label: "2주일", date: shiftDate(targetDate, -14) },
    { label: "1주일", date: shiftDate(targetDate, -7) },
    { label: "3일", date: shiftDate(targetDate, -3) },
    { label: "1일", date: shiftDate(targetDate, -1) }
  ];

  return targets.map((target) => {
    const point = historyPointOnOrBefore(points, target.date);
    if (!point) {
      return {
        label: target.label,
        date: null,
        valueKrw: null,
        deltaKrw: null,
        rate: null
      };
    }

    const deltaKrw = summary.totalIncomeKrw - point.totalIncomeKrw;
    return {
      label: target.label,
      date: point.date,
      valueKrw: point.totalIncomeKrw,
      deltaKrw,
      rate: dashboardIncomeChangeRate(deltaKrw, point.totalIncomeKrw)
    };
  });
}

function dashboardIncomeChangeRate(deltaKrw: number, baseKrw: number) {
  if (baseKrw === 0) return deltaKrw === 0 ? 0 : null;
  if (baseKrw < 0) return null;
  return roundNumber((deltaKrw / baseKrw) * 100, 1);
}

function buildTransactionFlow(transactions: AssetTransaction[]): TransactionFlowSummary {
  const months = new Map<string, CashFlowMonthRow>();
  let excludedZeroTrades = 0;
  let ignoredMaturityCount = 0;

  transactions.forEach((transaction) => {
    if (transaction.transactionType === "maturity") {
      ignoredMaturityCount += 1;
      return;
    }

    if (isZeroQuantityTrade(transaction)) {
      excludedZeroTrades += 1;
      return;
    }

    const monthKey = transaction.transactionDate.slice(0, 7);
    const row = months.get(monthKey) ?? emptyCashFlowMonthRow(monthKey);
    const amountKrw = transactionFlowValueKrw(transaction);

    if (transaction.transactionType === "buy") {
      row.buyKrw += amountKrw;
      row.buyCount += 1;
    } else if (transaction.transactionType === "sell") {
      row.sellKrw += amountKrw;
      row.realizedGainKrw += transaction.realizedGainKrw;
      row.sellCount += 1;
    } else if (transaction.transactionType === "dividend") {
      row.dividendKrw += amountKrw;
      row.dividendCount += 1;
    } else if (transaction.transactionType === "deposit") {
      row.depositKrw += amountKrw;
      row.depositCount += 1;
    }

    addCashFlowReportItem(row, transaction, amountKrw);
    row.transactionCount += 1;
    months.set(monthKey, row);
  });

  const allRows = Array.from(months.values())
    .map(roundCashFlowMonthRow)
    .filter((row) => row.grossKrw > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
  const rows = allRows.slice(-8).sort((a, b) => b.key.localeCompare(a.key));
  const totals = rows.reduce(
    (acc, row) => ({
      buyKrw: acc.buyKrw + row.buyKrw,
      sellKrw: acc.sellKrw + row.sellKrw,
      dividendKrw: acc.dividendKrw + row.dividendKrw,
      depositKrw: acc.depositKrw + row.depositKrw,
      depositCount: acc.depositCount + row.depositCount
    }),
    { buyKrw: 0, sellKrw: 0, dividendKrw: 0, depositKrw: 0, depositCount: 0 }
  );
  const maxMonthlyGrossKrw = rows.reduce((max, row) => Math.max(max, row.grossKrw), 0);
  const scopeLabel =
    allRows.length > rows.length
      ? `최근 ${rows.length.toLocaleString("ko-KR")}개 거래월`
      : rows.length > 0
        ? `${rows.length.toLocaleString("ko-KR")}개 거래월`
        : "거래월 없음";

  return {
    rows,
    scopeLabel,
    totalMonthCount: allRows.length,
    totalBuyKrw: totals.buyKrw,
    totalSellKrw: totals.sellKrw,
    totalDividendKrw: totals.dividendKrw,
    totalDepositKrw: totals.depositKrw,
    netBuyKrw: totals.buyKrw - totals.sellKrw,
    excludedZeroTrades,
    ignoredMaturityCount,
    depositCount: totals.depositCount,
    maxMonthlyGrossKrw,
    insights: transactionFlowInsights(rows, excludedZeroTrades, ignoredMaturityCount, totals.depositCount)
  };
}

function emptyCashFlowMonthRow(monthKey: string): CashFlowMonthRow {
  return {
    key: monthKey,
    label: monthKey.replace("-", "."),
    buyKrw: 0,
    sellKrw: 0,
    dividendKrw: 0,
    depositKrw: 0,
    realizedGainKrw: 0,
    transactionCount: 0,
    buyCount: 0,
    sellCount: 0,
    dividendCount: 0,
    depositCount: 0,
    netBuyKrw: 0,
    grossKrw: 0,
    report: emptyCashFlowMonthReport()
  };
}

function emptyCashFlowMonthReport(): CashFlowMonthReport {
  return {
    buy: [],
    sell: [],
    dividend: [],
    deposit: []
  };
}

function addCashFlowReportItem(row: CashFlowMonthRow, transaction: AssetTransaction, amountKrw: number) {
  if (!isCashFlowReportType(transaction.transactionType) || amountKrw <= 0) return;

  const itemKey = cashFlowReportItemKey(transaction);
  const items = row.report[transaction.transactionType];
  const current = items.find((item) => item.key === itemKey);
  const quantity = transaction.quantity ?? null;

  if (current) {
    current.amountKrw += amountKrw;
    current.realizedGainKrw += transaction.transactionType === "sell" ? transaction.realizedGainKrw : 0;
    current.transactionCount += 1;
    current.quantity = addNullableQuantity(current.quantity, quantity);
    return;
  }

  items.push({
    key: itemKey,
    type: transaction.transactionType,
    name: transactionFlowItemName(transaction),
    accountName: transaction.accountName,
    quantity,
    amountKrw,
    realizedGainKrw: transaction.transactionType === "sell" ? transaction.realizedGainKrw : 0,
    transactionCount: 1
  });
}

function isCashFlowReportType(type: TransactionType): type is CashFlowReportType {
  return type === "buy" || type === "sell" || type === "dividend" || type === "deposit";
}

function cashFlowReportItemKey(transaction: AssetTransaction) {
  const assetKey = transaction.positionKey ?? transaction.assetId ?? transaction.assetName ?? "cash";
  return `${transaction.transactionType}:${assetKey}:${transaction.accountId}`;
}

function transactionFlowItemName(transaction: AssetTransaction) {
  if (transaction.assetName) return transaction.assetName;
  return transaction.transactionType === "deposit" ? "입금성 거래" : "자산";
}

function addNullableQuantity(current: number | null, next: number | null) {
  if (current === null) return next;
  if (next === null) return current;
  return current + next;
}

function roundCashFlowMonthRow(row: CashFlowMonthRow): CashFlowMonthRow {
  return {
    ...row,
    buyKrw: Math.round(row.buyKrw),
    sellKrw: Math.round(row.sellKrw),
    dividendKrw: Math.round(row.dividendKrw),
    depositKrw: Math.round(row.depositKrw),
    realizedGainKrw: Math.round(row.realizedGainKrw),
    netBuyKrw: Math.round(row.buyKrw - row.sellKrw),
    grossKrw: Math.round(row.buyKrw + row.sellKrw + row.dividendKrw + row.depositKrw),
    report: {
      buy: roundCashFlowReportItems(row.report.buy),
      sell: roundCashFlowReportItems(row.report.sell),
      dividend: roundCashFlowReportItems(row.report.dividend),
      deposit: roundCashFlowReportItems(row.report.deposit)
    }
  };
}

function roundCashFlowReportItems(items: CashFlowReportItem[]) {
  return items
    .map((item) => ({
      ...item,
      quantity: item.quantity === null ? null : roundNumber(item.quantity, 6),
      amountKrw: Math.round(item.amountKrw),
      realizedGainKrw: Math.round(item.realizedGainKrw)
    }))
    .sort((a, b) => b.amountKrw - a.amountKrw);
}

function transactionFlowValueKrw(transaction: AssetTransaction) {
  if (transaction.transactionType === "dividend") {
    return positiveKrw(transaction.dividendIncomeKrw || nativeTransactionAmount(transaction) * transaction.fxRateToKrw);
  }

  return positiveKrw(nativeTransactionAmount(transaction) * transaction.fxRateToKrw);
}

function nativeTransactionAmount(transaction: AssetTransaction) {
  if (transaction.amount !== null && transaction.amount !== undefined) return transaction.amount;
  if (transaction.quantity !== null && transaction.price !== null) return transaction.quantity * transaction.price;
  return 0;
}

function positiveKrw(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function cashFlowSegments(row: CashFlowMonthRow) {
  return [
    { key: "buy", label: "매수", valueKrw: row.buyKrw },
    { key: "sell", label: "매도", valueKrw: row.sellKrw },
    { key: "dividend", label: "배당", valueKrw: row.dividendKrw },
    { key: "deposit", label: "입금", valueKrw: row.depositKrw }
  ];
}

function cashFlowMonthReportTitle(row: CashFlowMonthRow) {
  const parts = [
    row.buyCount > 0 ? `매수 ${row.buyCount.toLocaleString("ko-KR")}건` : "",
    row.sellCount > 0 ? `매도 ${row.sellCount.toLocaleString("ko-KR")}건` : "",
    row.dividendCount > 0 ? `배당 ${row.dividendCount.toLocaleString("ko-KR")}건` : "",
    row.depositCount > 0 ? `입금 ${row.depositCount.toLocaleString("ko-KR")}건` : ""
  ].filter(Boolean);

  return `${row.label}에는 ${parts.length > 0 ? parts.join(", ") : "표시할 거래"}이 있었습니다.`;
}

function transactionFlowInsights(
  rows: CashFlowMonthRow[],
  excludedZeroTrades: number,
  ignoredMaturityCount: number,
  depositCount: number
): CashFlowInsight[] {
  if (rows.length === 0) {
    return [];
  }

  const insights: CashFlowInsight[] = [];
  const recentRows = rows.slice(0, 3);
  const recentBuy = recentRows.reduce((sum, row) => sum + row.buyKrw, 0);
  const recentSell = recentRows.reduce((sum, row) => sum + row.sellKrw, 0);
  const recentNet = recentBuy - recentSell;
  insights.push({
    key: "recent-net",
    title: recentNet >= 0 ? "최근 순매수 우위" : "최근 매도 우위",
    detail: `최근 ${recentRows.length.toLocaleString("ko-KR")}개 거래월 기준 순매수 ${compactSignedKrw(recentNet)}입니다.`,
    tone: recentNet >= 0 ? "neutral" : "warning"
  });

  const largestBuyMonth = [...rows].sort((a, b) => b.buyKrw - a.buyKrw)[0];
  if (largestBuyMonth?.buyKrw > 0) {
    insights.push({
      key: "largest-buy",
      title: "가장 큰 매수월",
      detail: `${largestBuyMonth.label}에 ${compactKrw(largestBuyMonth.buyKrw)}을 매수했습니다.`,
      tone: "neutral"
    });
  }

  const largestSellMonth = [...rows].sort((a, b) => b.sellKrw - a.sellKrw)[0];
  if (largestSellMonth?.sellKrw > 0) {
    insights.push({
      key: "largest-sell",
      title: "가장 큰 매도월",
      detail: `${largestSellMonth.label}에 매도 대금 ${compactKrw(largestSellMonth.sellKrw)}이 발생했습니다.`,
      tone: "negative"
    });
  }

  const dividendMonths = rows.filter((row) => row.dividendKrw > 0).length;
  if (dividendMonths > 0) {
    const totalDividend = rows.reduce((sum, row) => sum + row.dividendKrw, 0);
    insights.push({
      key: "dividend-months",
      title: "배당 발생",
      detail: `${dividendMonths.toLocaleString("ko-KR")}개 거래월에서 배당 ${compactKrw(totalDividend)}이 확인됩니다.`,
      tone: "positive"
    });
  }

  if (excludedZeroTrades > 0 || depositCount > 0 || ignoredMaturityCount > 0) {
    insights.push({
      key: "calculation-note",
      title: "계산 기준",
      detail: `0주 거래 ${excludedZeroTrades.toLocaleString("ko-KR")}건 제외 · 입금성 ${depositCount.toLocaleString("ko-KR")}건 참고 · 만기 ${ignoredMaturityCount.toLocaleString("ko-KR")}건 제외`,
      tone: excludedZeroTrades > 0 ? "warning" : "neutral"
    });
  }

  return insights.slice(0, 5);
}

function dashboardRiskInsights(
  summary: Summary,
  topAssets: AssetDetailItem[],
  accountRows: BreakdownItem[],
  bottomPerformers: PerformanceRow[],
  points: HistoryPoint[],
  targetDate: string
) {
  const insights: Array<{ title: string; detail: string; tone: "neutral" | "warning" | "negative" | "positive" }> = [];
  const topAsset = topAssets[0];
  const topAccount = accountRows[0];
  const priceErrors = summary.assets.filter((asset) => asset.lastPriceError);
  const monthPoint = historyPointOnOrBefore(points, shiftDate(targetDate, -30));

  if (topAsset && (topAsset.totalShare ?? 0) >= 30) {
    insights.push({
      title: "종목 집중도 확인",
      detail: `${topAsset.name} 비중이 ${formatPercent(topAsset.totalShare)}입니다.`,
      tone: "warning"
    });
  }

  if (topAccount && topAccount.share >= 45) {
    insights.push({
      title: "계좌 집중도 확인",
      detail: `${topAccount.label} 계좌가 전체의 ${formatPercent(topAccount.share)}입니다.`,
      tone: "warning"
    });
  }

  const worst = bottomPerformers[0];
  if (worst && (worst.gainRate ?? 0) < 0) {
    insights.push({
      title: "손실 종목 확인",
      detail: `${worst.label} 수익률 ${formatPercent(worst.gainRate)} · 손익 ${compactSignedKrw(worst.gainKrw)}`,
      tone: "negative"
    });
  }

  if (priceErrors.length > 0) {
    insights.push({
      title: "시세 오류",
      detail: `${priceErrors.slice(0, 2).map((asset) => asset.name).join(", ")}${priceErrors.length > 2 ? ` 외 ${priceErrors.length - 2}개` : ""}`,
      tone: "negative"
    });
  }

  if (!monthPoint) {
    insights.push({
      title: "기간 비교 데이터 부족",
      detail: "1개월 전 기준점이 없어 최근 변화 일부를 계산하지 못했습니다.",
      tone: "neutral"
    });
  }

  if (summary.lockedValueKrw > 0) {
    insights.push({
      title: "현금화 제한",
      detail: `총 ${compactKrw(summary.lockedValueKrw)}이 계좌 또는 자산 제한 상태입니다.`,
      tone: "warning"
    });
  }

  if (insights.length === 0) {
    insights.push({
      title: "특이사항 없음",
      detail: "현재 데이터 기준 큰 집중, 손실, 시세 오류가 보이지 않습니다.",
      tone: "positive"
    });
  }

  return insights.slice(0, 5);
}

function liquidityDashboardColor(key: string) {
  if (key === "liquid") return "var(--positive)";
  if (key === "account-locked") return "var(--warning)";
  if (key === "asset-locked") return "#6d7782";
  return "";
}

function AccountBreakdownList({ items, assets }: { items: BreakdownItem[]; assets: AssetValuation[] }) {
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  if (items.length === 0) {
    return <span className="emptyText">등록된 자산 없음</span>;
  }

  return (
    <div className="allocationBreakdownList">
      {items.map((item, index) => {
        const color = allocationColors[index % allocationColors.length];
        const details = accountAssetDetails(assets, item.key);
        const isActive = activeAccountId === item.key;

        return (
          <div className={isActive ? "allocationBreakdownItem active" : "allocationBreakdownItem"} key={item.key}>
            <button type="button" aria-expanded={isActive} onClick={() => setActiveAccountId((current) => (current === item.key ? null : item.key))}>
              <span className="allocationName">
                <i style={{ background: color }} />
                <strong>{item.label}</strong>
              </span>
              <span className="allocationAmount">{formatKrw(item.valueKrw)}</span>
              <b className={gainClass(item.gainKrw)}>{formatPercent(item.gainRate)}</b>
              <span className="allocationBar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, item.share)}%`, background: color }} />
              </span>
            </button>
            {isActive && (
              <AllocationDetailList
                details={details}
                groupShareLabel="계좌 내"
                amountFormatter={formatKrwThousands}
                signedAmountFormatter={formatSignedKrwThousands}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange
}: {
  options: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented">
      {Object.entries(options).map(([key, label]) => (
        <button className={value === key ? "active" : ""} key={key} type="button" onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function buildSummaryMetricDetails(summary: Summary, transactions: AssetTransaction[], basisDate: string) {
  const details = new Map<string, MetricDetail>();
  const assets = summary.assets;
  const transactionsToDate = transactions.filter((transaction) => transaction.transactionDate <= basisDate);
  const liquidAssets = assets.filter((asset) => asset.isLiquidByDate);
  const lockedAssets = assets.filter((asset) => !asset.isLiquidByDate);
  const realizedTransactions = transactionsToDate.filter((transaction) => transaction.realizedGainKrw !== 0);
  const dividendTransactions = transactionsToDate.filter((transaction) => transaction.dividendIncomeKrw !== 0);

  details.set("total-assets", {
    key: "total-assets",
    title: "총자산 구성",
    totalKrw: summary.totalValueKrw,
    basisDate,
    format: "money",
    rows: assetDetailRows(assets, "value"),
    emptyText: "표시할 보유 자산이 없습니다.",
    note: "보유 자산의 평가금액 합계입니다."
  });
  details.set("total-cost", {
    key: "total-cost",
    title: "총 원금 구성",
    totalKrw: summary.totalCostKrw,
    basisDate,
    format: "money",
    rows: assetDetailRows(assets, "cost"),
    emptyText: "표시할 원금 내역이 없습니다.",
    note: "보유 자산의 원금 기준 합계입니다."
  });
  details.set("liquid", {
    key: "liquid",
    title: "현금화 가능 내역",
    totalKrw: summary.liquidValueKrw,
    basisDate,
    format: "money",
    rows: assetDetailRows(liquidAssets, "value"),
    emptyText: "현재 현금화 가능한 자산이 없습니다.",
    note: "현재 기준 현금화 가능으로 분류된 자산입니다."
  });
  details.set("locked", {
    key: "locked",
    title: "제한 자산 내역",
    totalKrw: summary.lockedValueKrw,
    basisDate,
    format: "money",
    rows: assetDetailRows(lockedAssets, "value", lockedAssetMeta),
    emptyText: "현재 제한 상태인 자산이 없습니다.",
    note: "계좌 제한과 사용자가 지정한 자산 제한을 기준으로 합니다."
  });
  details.set("total-income", {
    key: "total-income",
    title: "총수익 구성",
    totalKrw: summary.totalIncomeKrw,
    basisDate,
    format: "signed",
    rows: [
      {
        id: "total-income-unrealized",
        label: "평가손익",
        meta: "현재 보유 자산의 미실현 손익",
        amountKrw: roundMetricAmount(summary.unrealizedGainKrw),
        tone: metricTone(summary.unrealizedGainKrw)
      },
      {
        id: "total-income-realized",
        label: "차익실현",
        meta: `${realizedTransactions.length.toLocaleString("ko-KR")}건 거래 기준`,
        amountKrw: roundMetricAmount(summary.realizedGainKrw),
        tone: metricTone(summary.realizedGainKrw)
      },
      {
        id: "total-income-dividend",
        label: "배당수익",
        meta: `${dividendTransactions.length.toLocaleString("ko-KR")}건 배당 기준`,
        amountKrw: roundMetricAmount(summary.dividendIncomeKrw),
        tone: metricTone(summary.dividendIncomeKrw)
      }
    ],
    emptyText: "표시할 수익 구성 내역이 없습니다.",
    note: "평가손익, 차익실현, 배당수익을 합산합니다."
  });
  details.set("unrealized", {
    key: "unrealized",
    title: "평가손익 내역",
    totalKrw: summary.unrealizedGainKrw,
    basisDate,
    format: "signed",
    rows: groupedUnrealizedGainDetailRows(assets),
    emptyText: "평가손익이 있는 보유 자산이 없습니다.",
    note: "현재 보유 자산별 미실현 손익입니다.",
    groupRowsByTone: true
  });
  details.set("realized", {
    key: "realized",
    title: "차익실현 내역",
    totalKrw: summary.realizedGainKrw,
    basisDate,
    format: "signed",
    rows: transactionDetailRows(realizedTransactions, "realized"),
    emptyText: "차익실현 거래가 없습니다.",
    note: "기준일까지 반영된 실현손익 거래입니다.",
    groupRowsByTone: true
  });
  details.set("dividend", {
    key: "dividend",
    title: "배당수익 내역",
    totalKrw: summary.dividendIncomeKrw,
    basisDate,
    format: "signed",
    rows: groupedDividendIncomeDetailRows(dividendTransactions, assets),
    emptyText: "배당수익 거래가 없습니다.",
    note: "기준일까지 반영된 배당 거래입니다.",
    groupRowsByTone: true
  });

  return details;
}

function buildSimulationMetricDetails(
  result: SimulationResult,
  incomes: SimulationIncome[],
  accounts: Account[],
  startDate: string,
  endDate: string
) {
  const details = new Map<string, MetricDetail>();
  const finalPoint = result.finalPoint;
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const incomeEvents = expandSimulationIncomeEvents(incomes, accountById, startDate, endDate);
  const liquidAssets = result.assetRows.filter((asset) => asset.availableFrom !== null && asset.availableFrom <= finalPoint.date);
  const liquidAssetValue = liquidAssets.reduce((sum, asset) => sum + asset.valueKrw, 0);
  const liquidIncomeValue = Math.max(0, finalPoint.liquidValueKrw - liquidAssetValue);

  details.set("simulation-total", {
    key: "simulation-total",
    title: "예상 총자산 구성",
    totalKrw: finalPoint.totalValueKrw,
    basisDate: finalPoint.date,
    format: "money",
    rows: [
      {
        id: "simulation-total-assets",
        label: "시작 자산",
        meta: `${result.assetRows.length.toLocaleString("ko-KR")}개 자산`,
        amountKrw: roundMetricAmount(result.startingAssetsKrw)
      },
      {
        id: "simulation-total-income",
        label: "누적 예상 수입",
        meta: `${incomeEvents.length.toLocaleString("ko-KR")}건 예상 이벤트`,
        amountKrw: roundMetricAmount(result.cumulativeIncomeKrw)
      }
    ],
    emptyText: "예상 총자산 구성 내역이 없습니다.",
    note: "시작 자산에 시뮬레이션 기간의 예상 수입을 더합니다."
  });
  details.set("simulation-liquid", {
    key: "simulation-liquid",
    title: "시뮬레이션 현금화 가능 내역",
    totalKrw: finalPoint.liquidValueKrw,
    basisDate: finalPoint.date,
    format: "money",
    rows: [
      ...simulationAssetDetailRows(liquidAssets),
      ...(liquidIncomeValue > 0
        ? [
            {
              id: "simulation-liquid-income",
              label: "현금화 가능 예상 수입",
              meta: "시뮬레이션 기간 중 현금화 가능해진 수입",
              amountKrw: roundMetricAmount(liquidIncomeValue)
            }
          ]
        : [])
    ],
    emptyText: "시뮬레이션 종료 시점에 현금화 가능한 내역이 없습니다.",
    note: "종료 기준일에 현금화 가능한 자산과 수입입니다."
  });
  details.set("simulation-locked", {
    key: "simulation-locked",
    title: "시뮬레이션 제한 자산 내역",
    totalKrw: finalPoint.lockedValueKrw,
    basisDate: finalPoint.date,
    format: "money",
    rows: [
      ...simulationLockedDetailRows(finalPoint.detail.accountLockedItems, "계좌 제한"),
      ...simulationLockedDetailRows(finalPoint.detail.assetLockedItems, "자산 제한")
    ],
    emptyText: "시뮬레이션 종료 시점에 제한 상태인 내역이 없습니다.",
    note: "종료 기준일에도 현금화되지 않은 계좌/자산 제한입니다."
  });
  details.set("simulation-income", {
    key: "simulation-income",
    title: "누적 예상 수입 내역",
    totalKrw: result.cumulativeIncomeKrw,
    basisDate: finalPoint.date,
    format: "money",
    rows: simulationIncomeDetailRows(incomeEvents),
    emptyText: "입력된 예상 수입이 없습니다.",
    note: "반복 수입은 기간 내 발생 횟수별로 합산합니다."
  });

  return details;
}

function assetDetailRows(
  assets: AssetValuation[],
  amountType: "value" | "cost" | "gain",
  metaFormatter: (asset: AssetValuation) => string = baseAssetMeta
): MetricDetailRow[] {
  return [...assets]
    .sort((a, b) => Math.abs(metricAssetAmount(b, amountType)) - Math.abs(metricAssetAmount(a, amountType)))
    .map((asset) => ({
      id: `${amountType}-${asset.id}`,
      label: asset.name,
      meta: metaFormatter(asset),
      amountKrw: roundMetricAmount(metricAssetAmount(asset, amountType)),
      rateText: amountType === "gain" ? formatPercent(asset.gainRate) : undefined,
      tone: amountType === "gain" ? metricTone(asset.gainKrw) : undefined
    }));
}

function groupedUnrealizedGainDetailRows(assets: AssetValuation[]): MetricDetailRow[] {
  return groupedUnrealizedGainRows(assets).map((row) => {
    const tickerText = row.ticker ? ` · ${row.ticker}` : "";
    const countText = row.count > 1 ? ` · ${row.count.toLocaleString("ko-KR")}건 합산` : "";

    return {
      id: `unrealized-${row.key}`,
      label: row.label,
      meta: `${row.accountName} · ${assetLabels[row.type]}${tickerText}${countText}`,
      amountKrw: roundMetricAmount(row.amountKrw),
      rateText: formatPercent(row.gainRate),
      tone: metricTone(row.amountKrw)
    };
  });
}

function transactionDetailRows(transactions: AssetTransaction[], type: "realized" | "dividend"): MetricDetailRow[] {
  return [...transactions]
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || Math.abs(metricTransactionAmount(b, type)) - Math.abs(metricTransactionAmount(a, type)))
    .map((transaction) => ({
      id: `${type}-${transaction.id}`,
      label: transaction.assetName ?? (transaction.transactionType === "deposit" ? "현금" : "자산"),
      meta: `${formatDisplayDate(transaction.transactionDate)} · ${transaction.accountName} · ${transactionLabels[transaction.transactionType]}`,
      amountKrw: roundMetricAmount(metricTransactionAmount(transaction, type)),
      tone: metricTone(metricTransactionAmount(transaction, type))
    }));
}

function groupedDividendIncomeDetailRows(transactions: AssetTransaction[], assets: AssetValuation[]): MetricDetailRow[] {
  return groupedDividendIncomeRows(transactions, assets).map((row) => ({
    id: `dividend-${row.key}`,
    label: row.label,
    meta: `${row.accountName} · ${row.count.toLocaleString("ko-KR")}건 · ${formatMetricDateRange(row.firstDate, row.lastDate)}`,
    amountKrw: roundMetricAmount(row.amountKrw),
    tone: metricTone(row.amountKrw)
  }));
}

function formatMetricDateRange(firstDate: string, lastDate: string) {
  return firstDate === lastDate ? formatDisplayDate(firstDate) : `${formatDisplayDate(firstDate)}~${formatDisplayDate(lastDate)}`;
}

function simulationAssetDetailRows(assets: SimulationAssetRow[]): MetricDetailRow[] {
  return [...assets]
    .sort((a, b) => b.valueKrw - a.valueKrw)
    .map((asset) => ({
      id: `simulation-asset-${asset.id}`,
      label: asset.name,
      meta: `${asset.accountName} · ${asset.availableFrom ? `${asset.availableFrom}부터 가능` : "현금화 불가"}`,
      amountKrw: roundMetricAmount(asset.valueKrw)
    }));
}

function simulationLockedDetailRows(items: SimulationLockedItem[], reasonLabel: string): MetricDetailRow[] {
  return items.map((item) => ({
    id: `${reasonLabel}-${item.key}`,
    label: item.name,
    meta: `${reasonLabel} · ${simulationLockedItemMeta(item)}`,
    amountKrw: roundMetricAmount(item.amountKrw),
    tone: "warning" as const
  }));
}

function simulationIncomeDetailRows(events: SimulationIncomeEvent[]): MetricDetailRow[] {
  const grouped = events.reduce<Map<string, { name: string; accountName: string | null; amountKrw: number; count: number; firstDate: string; lastDate: string }>>(
    (acc, event) => {
      const key = `${event.name}:${event.accountName ?? ""}`;
      const current =
        acc.get(key) ??
        {
          name: event.name,
          accountName: event.accountName,
          amountKrw: 0,
          count: 0,
          firstDate: event.date,
          lastDate: event.date
        };
      current.amountKrw += event.amountKrw;
      current.count += 1;
      if (event.date < current.firstDate) current.firstDate = event.date;
      if (event.date > current.lastDate) current.lastDate = event.date;
      acc.set(key, current);
      return acc;
    },
    new Map()
  );

  return Array.from(grouped.entries())
    .map(([key, row]) => ({
      id: `simulation-income-${key}`,
      label: row.name,
      meta: `${row.accountName ? `${row.accountName} · ` : ""}${row.count.toLocaleString("ko-KR")}회 · ${formatDisplayDate(row.firstDate)}~${formatDisplayDate(row.lastDate)}`,
      amountKrw: roundMetricAmount(row.amountKrw)
    }))
    .sort((a, b) => b.amountKrw - a.amountKrw);
}

function metricAssetAmount(asset: AssetValuation, amountType: "value" | "cost" | "gain") {
  if (amountType === "cost") return asset.costKrw;
  if (amountType === "gain") return asset.gainKrw;
  return asset.valueKrw;
}

function metricTransactionAmount(transaction: AssetTransaction, type: "realized" | "dividend") {
  return type === "realized" ? transaction.realizedGainKrw : transaction.dividendIncomeKrw;
}

function baseAssetMeta(asset: AssetValuation) {
  const tickerText = asset.ticker ? ` · ${asset.ticker}` : "";
  return `${asset.accountName} · ${assetLabels[asset.type]}${tickerText}`;
}

function lockedAssetMeta(asset: AssetValuation) {
  if (asset.liquidityBlockReason === "account") {
    return `${asset.accountName} · 계좌 제한${asset.accountLiquidityUnlockDate ? ` · ${asset.accountLiquidityUnlockDate} 이후` : ""}`;
  }
  return `${asset.accountName} · 자산 제한 · ${asset.effectiveLiquidFrom} 이후`;
}

function metricTone(value: number): MetricDetailRow["tone"] {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function metricDetailRowClass(row: MetricDetailRow, format: MetricDetailFormat) {
  if (row.tone === "warning") return "gain warning";
  if (format === "signed" || row.tone === "positive" || row.tone === "negative") return gainClass(row.amountKrw);
  return "";
}

function formatMetricDetailAmount(value: number, format: MetricDetailFormat) {
  return format === "signed" ? formatSignedKrw(value) : formatKrw(value);
}

function roundMetricAmount(value: number) {
  return Math.round(value);
}

function LiquiditySplitBar({ liquidRatio }: { liquidRatio: number }) {
  const safeLiquidRatio = Math.max(0, Math.min(100, liquidRatio));

  return (
    <div className="liquiditySplitBar" role="presentation">
      <span style={{ width: `${safeLiquidRatio}%` }} />
      <i style={{ width: `${100 - safeLiquidRatio}%` }} />
    </div>
  );
}

function Metric({
  title,
  value,
  detail,
  icon,
  tone = "neutral",
  priority = "normal",
  selected = false,
  onClick
}: {
  title: string;
  value: string;
  detail?: string;
  icon: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning";
  priority?: "normal" | "high";
  selected?: boolean;
  onClick?: () => void;
}) {
  const className = `metric ${tone} ${priority}${onClick ? " clickable" : ""}${selected ? " selected" : ""}`;
  const content = (
    <>
      <span>{icon}</span>
      <p>{title}</p>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </>
  );

  if (onClick) {
    return (
      <button className={className} type="button" aria-pressed={selected} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <article className={className}>
      {content}
    </article>
  );
}

function MetricDetailPanel({ detail, onClose }: { detail: MetricDetail; onClose: () => void }) {
  const sumKrw = detail.rows.reduce((sum, row) => sum + row.amountKrw, 0);
  const rowSections = metricDetailRowSections(detail);

  return (
    <section className="metricDetailPanel" aria-label={`${detail.title} 상세 내역`}>
      <div className="metricDetailHeader">
        <div>
          <span>{formatDisplayDate(detail.basisDate)} 기준</span>
          <strong>{detail.title}</strong>
          {detail.note && <small>{detail.note}</small>}
        </div>
        <div>
          <b className={detail.format === "signed" ? gainClass(detail.totalKrw) : ""}>
            {formatMetricDetailAmount(detail.totalKrw, detail.format)}
          </b>
          <button type="button" onClick={onClose} aria-label="상세 내역 닫기">
            <X size={16} />
          </button>
        </div>
      </div>

      {detail.rows.length === 0 ? (
        <span className="emptyText">{detail.emptyText}</span>
      ) : (
        <>
          <div className="metricDetailList">
            {rowSections.map((section) => (
              <div className="metricDetailSection" key={section.key}>
                {section.label && (
                  <div className={`metricDetailSectionHeader ${section.tone}`}>
                    <span>{section.label}</span>
                    <b>
                      {formatMetricDetailAmount(section.totalKrw, detail.format)} · {section.rows.length.toLocaleString("ko-KR")}개
                    </b>
                  </div>
                )}
                {section.rows.map((row) => (
                  <div className="metricDetailItem" key={row.id}>
                    <span>
                      <strong>{row.label}</strong>
                      <small>{row.meta}</small>
                    </span>
                    <div>
                      <b className={metricDetailRowClass(row, detail.format)}>
                        {formatMetricDetailAmount(row.amountKrw, detail.format)}
                      </b>
                      {row.rateText && <em className={metricDetailRowClass(row, detail.format)}>{row.rateText}</em>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="metricDetailFooter">
            <span>상세 합계</span>
            <b className={detail.format === "signed" ? gainClass(sumKrw) : ""}>{formatMetricDetailAmount(sumKrw, detail.format)}</b>
          </div>
        </>
      )}
    </section>
  );
}

function metricDetailRowSections(detail: MetricDetail) {
  if (!detail.groupRowsByTone) {
    return [{ key: "all", label: "", tone: "neutral", rows: detail.rows, totalKrw: detail.rows.reduce((sum, row) => sum + row.amountKrw, 0) }];
  }

  const sections = [
    { key: "positive", label: "수익 합계", tone: "positive", rows: detail.rows.filter((row) => row.amountKrw > 0) },
    { key: "negative", label: "손실 합계", tone: "negative", rows: detail.rows.filter((row) => row.amountKrw < 0) },
    { key: "neutral", label: "변동 없음", tone: "neutral", rows: detail.rows.filter((row) => row.amountKrw === 0) }
  ];

  return sections
    .filter((section) => section.rows.length > 0)
    .map((section) => ({
      ...section,
      totalKrw: section.rows.reduce((sum, row) => sum + row.amountKrw, 0)
    }));
}

function TradeSaveSummary({
  mode,
  form,
  selectedPosition,
  estimatedSellGain,
  estimatedSellRate,
  estimatedDividendKrw
}: {
  mode: TransactionMode;
  form: AssetForm;
  selectedPosition: AssetPosition | null;
  estimatedSellGain: number | null;
  estimatedSellRate: number | null;
  estimatedDividendKrw: number;
}) {
  const quantity = toNumberOrNull(form.quantity);
  const unitValue = toNumberOrNull(form.currentValue);
  const averageCost = toNumberOrNull(form.averageCost);
  const fxRate = Number(form.fxRateToKrw || 1);
  const buyAmount = quantity !== null && averageCost !== null ? quantity * averageCost * fxRate : (unitValue ?? 0) * fxRate;
  const sellAmount = (quantity ?? 0) * (unitValue ?? 0) * fxRate;

  return (
    <section className="tradePreview saveSummary" aria-label="저장 전 요약">
      <div className="formStepHeader">
        <span>5</span>
        <div>
          <strong>저장 전 요약</strong>
          <p>{transactionLabels[mode]} 저장 후 반영될 금액을 확인합니다.</p>
        </div>
      </div>
      <dl>
        <div>
          <dt>대상</dt>
          <dd>{mode === "buy" ? form.name || "자산명 미입력" : selectedPosition?.name ?? "보유 자산 미선택"}</dd>
        </div>
        <div>
          <dt>거래일</dt>
          <dd>{form.valuationDate}</dd>
        </div>
        {mode === "buy" && (
          <div>
            <dt>매수 금액</dt>
            <dd>{formatKrw(Math.round(buyAmount))}</dd>
          </div>
        )}
        {mode === "sell" && (
          <>
            <div>
              <dt>매도 금액</dt>
              <dd>{formatKrw(Math.round(sellAmount))}</dd>
            </div>
            <div>
              <dt>예상 손익</dt>
              <dd className={gainClass(estimatedSellGain ?? 0)}>
                {formatSignedKrw(estimatedSellGain ?? 0)} · {formatPercent(estimatedSellRate)}
              </dd>
            </div>
          </>
        )}
        {mode === "dividend" && (
          <div>
            <dt>배당 수익</dt>
            <dd>{formatKrw(Math.round(estimatedDividendKrw))}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function buildSimulation(
  assets: AssetValuation[],
  incomes: SimulationIncome[],
  accounts: Account[],
  startDate: string,
  endDate: string
): SimulationResult {
  const safeEndDate = endDate < startDate ? startDate : endDate;
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const incomeEvents = expandSimulationIncomeEvents(incomes, accountById, startDate, safeEndDate);
  const assetRows = assets
    .filter((asset) => asset.valueKrw > 0)
    .map((asset) => {
      const availability = simulationAssetAvailability(asset);
      const state = simulationAssetState(availability.availableFrom, startDate, safeEndDate);

      return {
        id: asset.id,
        groupKey: assetAggregationKey(asset),
        accountId: asset.accountId,
        name: asset.name,
        accountName: asset.accountName,
        valueKrw: Math.round(asset.valueKrw),
        availableFrom: availability.availableFrom,
        blockReason: availability.blockReason,
        restrictionText: availability.restrictionText,
        state
      };
    })
    .sort((a, b) => b.valueKrw - a.valueKrw);
  const startingAssetsKrw = assetRows.reduce((sum, asset) => sum + asset.valueKrw, 0);
  const dates = simulationDates(startDate, safeEndDate, assetRows, incomeEvents);
  const rawPoints = dates.map((date) => {
    const incomeToDate = incomeEvents.filter((event) => event.date <= date);
    const lockedAssets = assetRows.filter((asset) => asset.availableFrom === null || asset.availableFrom > date);
    const lockedIncomes = incomeToDate.filter((event) => event.availableFrom === null || event.availableFrom > date);
    const cumulativeIncomeKrw = incomeToDate.reduce((sum, event) => sum + event.amountKrw, 0);
    const liquidAssetKrw = assetRows
      .filter((asset) => asset.availableFrom !== null && asset.availableFrom <= date)
      .reduce((sum, asset) => sum + asset.valueKrw, 0);
    const liquidIncomeKrw = incomeToDate
      .filter((event) => event.availableFrom !== null && event.availableFrom <= date)
      .reduce((sum, event) => sum + event.amountKrw, 0);
    const totalValueKrw = startingAssetsKrw + cumulativeIncomeKrw;
    const liquidValueKrw = liquidAssetKrw + liquidIncomeKrw;
    const accountLockedValueKrw =
      lockedAssets
        .filter((asset) => asset.blockReason === "account")
        .reduce((sum, asset) => sum + asset.valueKrw, 0) +
      lockedIncomes
        .filter((event) => event.blockReason === "account")
        .reduce((sum, event) => sum + event.amountKrw, 0);
    const assetLockedValueKrw =
      lockedAssets
        .filter((asset) => asset.blockReason !== "account")
        .reduce((sum, asset) => sum + asset.valueKrw, 0) +
      lockedIncomes
        .filter((event) => event.blockReason !== "account")
        .reduce((sum, event) => sum + event.amountKrw, 0);
    const newIncomes = incomeEvents.filter((event) => event.date === date);
    const releasedAssets = assetRows.filter((asset) => asset.availableFrom === date && date > startDate);
    const releasedIncomes = incomeEvents.filter((event) => event.availableFrom === date && event.date < date);
    const accountLockedItems = aggregateSimulationLockedItems([
      ...lockedAssets
        .filter((asset) => asset.blockReason === "account")
        .map((asset) => ({
          id: asset.groupKey,
          name: asset.name,
          accountName: asset.accountName,
          amountKrw: asset.valueKrw,
          availableFrom: asset.availableFrom,
          reason: "account" as const
        })),
      ...lockedIncomes
        .filter((event) => event.blockReason === "account")
        .map((event) => ({
          id: event.id,
          name: event.name,
          accountName: event.accountName,
          amountKrw: event.amountKrw,
          availableFrom: event.availableFrom,
          reason: "account" as const
        }))
    ]);
    const assetLockedItems = aggregateSimulationLockedItems([
      ...lockedAssets
        .filter((asset) => asset.blockReason !== "account")
        .map((asset) => ({
          id: asset.groupKey,
          name: asset.name,
          accountName: asset.accountName,
          amountKrw: asset.valueKrw,
          availableFrom: asset.availableFrom,
          reason: "asset" as const
        })),
      ...lockedIncomes
        .filter((event) => event.blockReason !== "account")
        .map((event) => ({
          id: event.id,
          name: event.name,
          accountName: event.accountName,
          amountKrw: event.amountKrw,
          availableFrom: event.availableFrom,
          reason: "asset" as const
        }))
    ]);

    return {
      date,
      totalValueKrw,
      liquidValueKrw,
      lockedValueKrw: Math.max(0, totalValueKrw - liquidValueKrw),
      accountLockedValueKrw,
      assetLockedValueKrw,
      cumulativeIncomeKrw,
      incomeKrw: newIncomes.reduce((sum, event) => sum + event.amountKrw, 0),
      detail: {
        newIncomes,
        releasedAssets,
        releasedIncomes,
        accountLockedItems,
        assetLockedItems
      }
    };
  });

  const points = monthlySimulationPoints(rawPoints);
  const finalPoint =
    points.at(-1) ?? {
      date: safeEndDate,
      periodStartDate: safeEndDate,
      periodEndDate: safeEndDate,
      totalValueKrw: startingAssetsKrw,
      liquidValueKrw: assetRows
        .filter((asset) => asset.availableFrom !== null && asset.availableFrom <= safeEndDate)
        .reduce((sum, asset) => sum + asset.valueKrw, 0),
      lockedValueKrw: 0,
      accountLockedValueKrw: 0,
      assetLockedValueKrw: 0,
      cumulativeIncomeKrw: 0,
      incomeKrw: 0,
      detail: {
        newIncomes: [],
        releasedAssets: [],
        releasedIncomes: [],
        accountLockedItems: [],
        assetLockedItems: []
      }
    };
  finalPoint.lockedValueKrw = Math.max(0, finalPoint.totalValueKrw - finalPoint.liquidValueKrw);

  return {
    points,
    finalPoint,
    startingAssetsKrw,
    cumulativeIncomeKrw: finalPoint.cumulativeIncomeKrw,
    assetRows
  };
}

function monthlySimulationPoints(points: SimulationPoint[]) {
  return groupSimulationPointsByMonth(points).map(({ periodStartDate, periodEndDate, representative, points: periodPoints }) => {
    const newIncomes = periodPoints.flatMap((point) => point.detail.newIncomes);
    const releasedAssets = periodPoints.flatMap((point) => point.detail.releasedAssets);
    const releasedIncomes = periodPoints.flatMap((point) => point.detail.releasedIncomes);

    return {
      ...representative,
      periodStartDate,
      periodEndDate,
      incomeKrw: periodPoints.reduce((sum, point) => sum + point.incomeKrw, 0),
      detail: {
        ...representative.detail,
        newIncomes,
        releasedAssets,
        releasedIncomes
      }
    };
  });
}

function simulationIncomeInputFromForm(
  type: SimulationIncomeType,
  form: SimulationIncomeForm,
  amountKrw: number
): SimulationIncomeInput {
  return {
    accountId: form.accountId || null,
    type,
    name: form.name.trim(),
    amountKrw,
    startDate: form.startDate,
    endDate: type === "monthly" && !form.repeatsIndefinitely ? form.endDate : null,
    repeatsIndefinitely: type === "monthly" ? form.repeatsIndefinitely : false,
    availability: form.availability,
    unlockDate: form.availability === "unlock_date" ? form.unlockDate : null,
    note: form.note.trim()
  };
}

function accountInputFromForm(form: AccountForm) {
  return {
    name: form.name.trim(),
    institution: form.institution.trim() || undefined,
    liquidityRestricted: form.liquidityRestricted,
    liquidityUnlockDate: form.liquidityRestricted ? form.liquidityUnlockDate : null,
    liquidityRestrictionReason: form.liquidityRestricted ? form.liquidityRestrictionReason.trim() || null : null
  };
}

function simulationIncomeInputFromIncome(income: SimulationIncome): SimulationIncomeInput {
  return {
    accountId: income.accountId,
    type: income.type,
    name: income.name,
    amountKrw: income.amountKrw,
    startDate: income.startDate,
    endDate: income.endDate,
    repeatsIndefinitely: income.repeatsIndefinitely,
    availability: income.availability,
    unlockDate: income.unlockDate,
    note: income.note
  };
}

function formFromSimulationIncome(income: SimulationIncome): SimulationIncomeForm {
  return {
    accountId: income.accountId ?? "",
    name: income.name,
    amount: income.amountKrw.toString(),
    startDate: income.startDate,
    endDate: income.endDate ?? "",
    repeatsIndefinitely: income.type === "monthly" ? income.repeatsIndefinitely : false,
    availability: income.availability,
    unlockDate: income.unlockDate ?? "",
    note: income.note
  };
}

function expandSimulationIncomeEvents(
  incomes: SimulationIncome[],
  accountById: Map<string, Account>,
  startDate: string,
  endDate: string
): SimulationIncomeEvent[] {
  return incomes.flatMap((income) => {
    if (income.amountKrw <= 0) return [];

    if (income.type === "one_time") {
      if (income.startDate < startDate || income.startDate > endDate) return [];
      return [
        {
          id: `${income.id}:${income.startDate}`,
          name: income.name,
          date: income.startDate,
          amountKrw: income.amountKrw,
          accountName: income.accountName,
          availableFrom: simulationIncomeAvailableFrom(income, accountById, income.startDate),
          blockReason: simulationIncomeBlockReason(income, accountById, income.startDate)
        }
      ];
    }

    const events: SimulationIncomeEvent[] = [];
    const recurringEndDate = income.endDate && !income.repeatsIndefinitely ? minDate(income.endDate, endDate) : endDate;
    let cursor = income.startDate;

    while (cursor <= recurringEndDate) {
      if (cursor >= startDate) {
        events.push({
          id: `${income.id}:${cursor}`,
          name: income.name,
          date: cursor,
          amountKrw: income.amountKrw,
          accountName: income.accountName,
          availableFrom: simulationIncomeAvailableFrom(income, accountById, cursor),
          blockReason: simulationIncomeBlockReason(income, accountById, cursor)
        });
      }
      cursor = addMonths(cursor, 1);
    }

    return events;
  });
}

function simulationDates(
  startDate: string,
  endDate: string,
  assetRows: SimulationResult["assetRows"],
  incomeEvents: Array<{ date: string; availableFrom: string | null }>
) {
  const dates = new Set<string>([startDate, endDate]);
  let cursor = startDate;

  while (cursor < endDate) {
    cursor = addMonths(cursor, 1);
    dates.add(cursor > endDate ? endDate : cursor);
  }

  assetRows.forEach((asset) => {
    if (asset.availableFrom && asset.availableFrom >= startDate && asset.availableFrom <= endDate) dates.add(asset.availableFrom);
  });
  incomeEvents.forEach((event) => {
    dates.add(event.date);
    if (event.availableFrom && event.availableFrom >= startDate && event.availableFrom <= endDate) dates.add(event.availableFrom);
  });

  return Array.from(dates).sort();
}

function simulationIncomeAvailableFrom(income: SimulationIncome, accountById: Map<string, Account>, incomeDate: string) {
  if (income.availability === "unavailable") return null;
  const incomeUnlockDate = income.availability === "unlock_date" ? income.unlockDate ?? null : incomeDate;
  const account = income.accountId ? accountById.get(income.accountId) : null;
  if (!account?.liquidityRestricted || !account.liquidityUnlockDate) return incomeUnlockDate;
  if (!incomeUnlockDate) return account.liquidityUnlockDate;
  return maxDate([incomeUnlockDate, account.liquidityUnlockDate]);
}

function simulationIncomeBlockReason(
  income: SimulationIncome,
  accountById: Map<string, Account>,
  incomeDate: string
): "account" | "asset" {
  if (income.availability === "unavailable") return "asset";
  const account = income.accountId ? accountById.get(income.accountId) : null;
  const accountUnlockDate = account?.liquidityRestricted ? account.liquidityUnlockDate : null;
  const incomeUnlockDate = income.availability === "unlock_date" ? income.unlockDate ?? null : incomeDate;
  return accountUnlockDate && (!incomeUnlockDate || accountUnlockDate >= incomeUnlockDate) ? "account" : "asset";
}

function simulationEndDateForRange(range: SimulationRange, startDate: string) {
  if (range === "6m") return addMonths(startDate, 6);
  if (range === "1y") return addMonths(startDate, 12);
  if (range === "3y") return addMonths(startDate, 36);
  return addMonths(startDate, 12);
}

function readDashboardStorage(targetDate: string): DashboardData | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(dashboardStorageKey);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as unknown;
    const data =
      isDashboardData(parsed)
        ? parsed
        : isDashboardStorageEnvelope(parsed)
          ? parsed.data
          : null;
    if (!data || data.date !== targetDate) return null;

    return {
      ...data,
      isSnapshot: true
    };
  } catch {
    return null;
  }
}

function writeDashboardStorage(data: DashboardData) {
  if (typeof window === "undefined") return;

  try {
    const compactData = compactDashboardDataForStorage(data);
    window.localStorage.setItem(
      dashboardStorageKey,
      JSON.stringify({
        version: dashboardStorageVersion,
        savedAt: new Date().toISOString(),
        data: compactData
      })
    );
  } catch {
    // 캐시 저장 실패는 화면 데이터 표시를 막지 않습니다.
  }
}

function compactDashboardDataForStorage(data: DashboardData): DashboardData {
  return {
    ...data,
    history: historyPointsForRange(data.history, data.date, dashboardStorageHistoryRange),
    transactions: data.transactions.slice(0, dashboardStorageTransactionLimit)
  };
}

function isDashboardStorageEnvelope(value: unknown): value is DashboardStorageEnvelope {
  return (
    isObjectRecord(value) &&
    (value.version === undefined || typeof value.version === "number") &&
    (value.savedAt === undefined || typeof value.savedAt === "string") &&
    isDashboardData(value.data)
  );
}

function isDashboardData(value: unknown): value is DashboardData {
  if (!isObjectRecord(value)) return false;
  const data = value as Partial<DashboardData>;

  return (
    typeof data.date === "string" &&
    Array.isArray(data.accounts) &&
    isDashboardSummary(data.summary) &&
    Array.isArray(data.positions) &&
    Array.isArray(data.history) &&
    Array.isArray(data.transactions) &&
    typeof data.syncedAt === "string" &&
    typeof data.isSnapshot === "boolean"
  );
}

function isDashboardSummary(value: unknown): value is Summary {
  if (!isObjectRecord(value)) return false;
  const summary = value as Partial<Summary>;

  return (
    typeof summary.date === "string" &&
    typeof summary.totalValueKrw === "number" &&
    typeof summary.totalCostKrw === "number" &&
    typeof summary.totalGainKrw === "number" &&
    typeof summary.unrealizedGainKrw === "number" &&
    typeof summary.realizedGainKrw === "number" &&
    typeof summary.dividendIncomeKrw === "number" &&
    typeof summary.totalIncomeKrw === "number" &&
    typeof summary.liquidValueKrw === "number" &&
    typeof summary.lockedValueKrw === "number" &&
    typeof summary.liquidRatio === "number" &&
    Array.isArray(summary.byTypeDetails) &&
    Array.isArray(summary.byAccountDetails) &&
    Array.isArray(summary.assets)
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readSimulationStorage() {
  const fallback = { range: "1y" as SimulationRange, endDate: simulationEndDateForRange("1y", today), incomes: [] as SimulationIncome[] };
  if (typeof window === "undefined") return fallback;

  try {
    const stored = window.localStorage.getItem("youngs-plan-simulation");
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<typeof fallback>;
    const range = parsed.range && parsed.range in simulationRangeLabels ? parsed.range : fallback.range;
    const endDate = typeof parsed.endDate === "string" && parsed.endDate >= today ? parsed.endDate : simulationEndDateForRange(range, today);
    const incomes = Array.isArray(parsed.incomes)
      ? parsed.incomes.filter(isSimulationIncome).map((income) => ({
          ...income,
          accountId: income.accountId ?? null,
          accountName: income.accountName ?? null
        }))
      : [];
    return { range, endDate, incomes };
  } catch {
    return fallback;
  }
}

function writeSimulationStorage(value: { range: SimulationRange; endDate: string; incomes: SimulationIncome[] }) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("youngs-plan-simulation", JSON.stringify(value));
}

function isSimulationIncome(value: unknown): value is SimulationIncome {
  if (!value || typeof value !== "object") return false;
  const income = value as SimulationIncome;
  return (
    typeof income.id === "string" &&
    (income.type === "monthly" || income.type === "one_time") &&
    typeof income.name === "string" &&
    typeof income.amountKrw === "number" &&
    typeof income.startDate === "string" &&
    (income.endDate === null || typeof income.endDate === "string") &&
    typeof income.repeatsIndefinitely === "boolean" &&
    (income.availability === "immediate" || income.availability === "unlock_date" || income.availability === "unavailable") &&
    (income.accountId === undefined || income.accountId === null || typeof income.accountId === "string") &&
    (income.accountName === undefined || income.accountName === null || typeof income.accountName === "string") &&
    (income.unlockDate === null || typeof income.unlockDate === "string") &&
    typeof income.note === "string"
  );
}

function simulationAssetStateText(asset: SimulationResult["assetRows"][number]) {
  if (asset.state === "liquid") return "즉시 현금화 가능";
  if (asset.state === "scheduled" && asset.availableFrom) return `${asset.availableFrom} 이후 가능`;
  return "시뮬레이션 기간 내 현금화 불가";
}

function simulationIncomeMeta(income: SimulationIncome, accountById: Map<string, Account>) {
  const typeText = income.type === "monthly" ? "월 반복" : "일회성";
  const dateText =
    income.type === "monthly"
      ? `${income.startDate}${income.endDate ? `~${income.endDate}` : "부터 계속"}`
      : income.startDate;
  const availableFrom = simulationIncomeAvailableFrom(income, accountById, income.startDate);
  const availabilityText = availableFrom ? `${availableFrom} 이후 현금화` : "기간 내 현금화 불가";
  const accountText = income.accountName ? ` · ${income.accountName}` : "";

  return `${typeText} · ${dateText} · ${availabilityText}${accountText}`;
}

function simulationIncomeEventMeta(event: SimulationIncomeEvent) {
  const accountText = event.accountName ? `${event.accountName} · ` : "";
  if (!event.availableFrom) return `${accountText}기간 내 현금화 불가`;
  if (event.availableFrom === event.date) return `${accountText}입금 즉시 현금화`;
  return `${accountText}${event.availableFrom} 이후 현금화`;
}

function simulationLockedItemMeta(item: SimulationLockedItem) {
  const accountText = item.accountName ? `${item.accountName} · ` : "";
  return `${accountText}${item.availableFrom ? `${item.availableFrom} 이후 가능` : "기간 내 현금화 불가"}`;
}

function aggregateSimulationLockedItems(items: Array<Omit<SimulationLockedItem, "key">>) {
  const grouped = items.reduce<Map<string, SimulationLockedItem>>((acc, item) => {
    const key = `${item.reason}:${item.id}:${item.availableFrom ?? "unavailable"}`;
    const existing = acc.get(key);
    if (!existing) {
      acc.set(key, { ...item, key });
      return acc;
    }

    existing.amountKrw += item.amountKrw;
    if (existing.accountName !== item.accountName) {
      existing.accountName = existing.accountName && item.accountName ? "여러 계좌" : existing.accountName ?? item.accountName;
    }
    return acc;
  }, new Map());

  return Array.from(grouped.values()).sort((a, b) => b.amountKrw - a.amountKrw);
}

function buildSimulationAssumptionSummary(assets: SimulationAssetRow[]) {
  const summary = [
    { key: "liquid", label: "즉시 가능", assets: assets.filter((asset) => asset.state === "liquid") },
    { key: "scheduled", label: "해제 예정", assets: assets.filter((asset) => asset.state === "scheduled") },
    { key: "unavailable", label: "기간 내 불가", assets: assets.filter((asset) => asset.state === "unavailable") },
    {
      key: "account",
      label: "계좌 제한",
      assets: assets.filter((asset) => asset.state !== "liquid" && asset.blockReason === "account")
    },
    {
      key: "asset",
      label: "자산 제한",
      assets: assets.filter((asset) => asset.state !== "liquid" && asset.blockReason !== "account")
    }
  ];

  return summary.map((item) => ({
    key: item.key,
    label: item.label,
    count: item.assets.length,
    valueKrw: item.assets.reduce((sum, asset) => sum + asset.valueKrw, 0)
  }));
}

function buildSimulationAssumptionGroups(assets: SimulationAssetRow[]) {
  return [
    { key: "liquid", label: "즉시 현금화 가능", assets: assets.filter((asset) => asset.state === "liquid") },
    { key: "scheduled", label: "해제 예정", assets: assets.filter((asset) => asset.state === "scheduled") },
    { key: "unavailable", label: "기간 내 현금화 불가", assets: assets.filter((asset) => asset.state === "unavailable") },
    {
      key: "account",
      label: "계좌 제한",
      assets: assets.filter((asset) => asset.state !== "liquid" && asset.blockReason === "account")
    },
    {
      key: "asset",
      label: "자산 제한",
      assets: assets.filter((asset) => asset.state !== "liquid" && asset.blockReason !== "account")
    }
  ]
    .filter((group) => group.assets.length > 0)
    .map((group) => ({
      ...group,
      valueKrw: group.assets.reduce((sum, asset) => sum + asset.valueKrw, 0)
    }));
}

function aggregateAssetRows(assets: AssetValuation[]): AssetValuation[] {
  const groups = assets.reduce<Map<string, AssetValuation[]>>((acc, asset) => {
    const key = assetAggregationKey(asset);
    acc.set(key, [...(acc.get(key) ?? []), asset]);
    return acc;
  }, new Map());

  return Array.from(groups.values())
    .map((group) => aggregateAssetGroup(group))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function filterAssetRows(assets: AssetValuation[], query: string, accountId: string, type: AssetType | "all") {
  const normalizedQuery = normalizeAssetName(query);

  return assets.filter((asset) => {
    const matchesQuery =
      !normalizedQuery ||
      [asset.name, asset.accountName, asset.ticker ?? "", assetLabels[asset.type], marketLabels[asset.market]]
        .map(normalizeAssetName)
        .some((value) => value.includes(normalizedQuery));
    const matchesAccount = accountId === "all" || asset.accountId === accountId;
    const matchesType = type === "all" || asset.type === type;

    return matchesQuery && matchesAccount && matchesType;
  });
}

function aggregateAssetGroup(group: AssetValuation[]): AssetValuation {
  if (group.length === 1) {
    return { ...group[0], lotCount: 1, lotIds: [group[0].id] };
  }

  const sortedByDate = [...group].sort((a, b) => a.valuationDate.localeCompare(b.valuationDate));
  const latest = [...group].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const totalQuantity = sumNullable(group.map((asset) => asset.quantity));
  const nativeCost = group.reduce((sum, asset) => sum + estimateAssetNativeCost(asset), 0);
  const nativeValue = group.reduce((sum, asset) => sum + estimateAssetNativeValue(asset), 0);
  const totalValueKrw = roundNumber(group.reduce((sum, asset) => sum + asset.valueKrw, 0), 0);
  const totalCostKrw = roundNumber(group.reduce((sum, asset) => sum + asset.costKrw, 0), 0);
  const gainKrw = totalValueKrw - totalCostKrw;

  return {
    ...latest,
    id: `group:${group.map((asset) => asset.id).sort().join(":")}`,
    quantity: totalQuantity,
    averageCost: totalQuantity !== null && totalQuantity > 0 && nativeCost > 0 ? roundNumber(nativeCost / totalQuantity, 4) : null,
    currentValue:
      totalQuantity !== null && totalQuantity > 0 && nativeValue > 0
        ? roundNumber(nativeValue / totalQuantity, 4)
        : roundNumber(nativeValue, 4),
    purchaseFxRateToKrw: nativeCost > 0 ? roundNumber(totalCostKrw / nativeCost, 4) : latest.purchaseFxRateToKrw,
    fxRateToKrw: nativeValue > 0 ? roundNumber(totalValueKrw / nativeValue, 4) : latest.fxRateToKrw,
    maturityDate: latestNonNull(group.map((asset) => asset.maturityDate)),
    maturityAmount: sumNullable(group.map((asset) => asset.maturityAmount)),
    maturityCurrency: latest.maturityCurrency,
    maturityFxRateToKrw: latest.maturityFxRateToKrw,
    autoConvertOnMaturity: group.some((asset) => asset.autoConvertOnMaturity),
    maturedAt: latestNonNull(group.map((asset) => asset.maturedAt)),
    valuationDate: sortedByDate[0].valuationDate,
    liquidFrom: group.reduce((maxDate, asset) => (asset.liquidFrom > maxDate ? asset.liquidFrom : maxDate), group[0].liquidFrom),
    priceSource: aggregatePriceSource(group),
    lastPriceAt: latestNonNull(group.map((asset) => asset.lastPriceAt)),
    lastPriceError: group.find((asset) => asset.lastPriceError)?.lastPriceError ?? null,
    createdAt: latest.createdAt,
    valueKrw: totalValueKrw,
    costKrw: totalCostKrw,
    gainKrw,
    gainRate: totalCostKrw > 0 ? roundNumber((gainKrw / totalCostKrw) * 100, 1) : null,
    isLiquidByDate: group.every((asset) => asset.isLiquidByDate),
    effectiveLiquidFrom: group.reduce(
      (maxDate, asset) => (asset.effectiveLiquidFrom > maxDate ? asset.effectiveLiquidFrom : maxDate),
      group[0].effectiveLiquidFrom
    ),
    liquidityBlockReason: group.every((asset) => asset.isLiquidByDate)
      ? "liquid"
      : group.some((asset) => asset.liquidityBlockReason === "account")
        ? "account"
        : "asset",
    lotCount: group.length,
    lotIds: group.map((asset) => asset.id),
    firstValuationDate: sortedByDate[0].valuationDate,
    latestValuationDate: sortedByDate[sortedByDate.length - 1].valuationDate
  };
}

function assetAggregationKey(asset: AssetValuation) {
  return `${asset.accountId}:${assetAggregationIdentity(asset)}`;
}

function assetDetailAggregationKey(asset: AssetValuation) {
  return assetAggregationIdentity(asset);
}

function assetAggregationIdentity(asset: AssetValuation) {
  const maturityPart = asset.type === "bond" && asset.maturityDate ? `:maturity:${asset.maturityDate}` : "";
  const identity = asset.ticker?.trim()
    ? `ticker:${asset.market}:${asset.ticker.trim().toUpperCase()}${maturityPart}`
    : `name:${asset.type}:${asset.market}:${asset.currency}:${normalizeAssetName(asset.name)}${maturityPart}`;

  return identity;
}

function normalizeAssetName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function sumNullable(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function latestNonNull(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function aggregatePriceSource(group: Array<Pick<AssetValuation, "priceSource">>): PriceSource {
  if (group.some((asset) => asset.priceSource === "yahoo")) return "yahoo";
  if (group.some((asset) => asset.priceSource === "stooq")) return "stooq";
  return "manual";
}

function priceSourceLabel(source: PriceSource) {
  return priceSourceLabels[source];
}

function roundNumber(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatAssetDateMeta(asset: AssetValuation) {
  if ((asset.lotCount ?? 1) > 1) {
    const firstDate = asset.firstValuationDate ?? asset.valuationDate;
    const latestDate = asset.latestValuationDate ?? asset.valuationDate;
    const purchaseText = firstDate === latestDate ? `매수일 ${firstDate}` : `매수일 ${firstDate}~${latestDate}`;
    return asset.effectiveLiquidFrom > latestDate ? `${purchaseText} · 현금화 가능 ${asset.effectiveLiquidFrom}` : purchaseText;
  }

  return asset.effectiveLiquidFrom > asset.valuationDate
    ? `현금화 가능 ${asset.effectiveLiquidFrom}`
    : `매수일 ${asset.valuationDate}`;
}

function formatNativeAmount(value: number, currency: string) {
  if (currency === "USD") {
    return formatUsd(value);
  }

  if (currency === "KRW") {
    return formatKrw(value);
  }

  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 4 })} ${currency}`;
}

function assetDisplayValue(asset: AssetValuation, showKrwForUsd: boolean) {
  if (asset.currency !== "USD" || showKrwForUsd) {
    return {
      value: formatKrw(asset.valueKrw),
      gain: formatSignedKrw(asset.gainKrw),
      gainValue: asset.gainKrw,
      gainRate: asset.gainRate
    };
  }

  const value = estimateAssetNativeValue(asset);
  const cost = estimateAssetNativeCost(asset);
  const gain = value - cost;

  return {
    value: formatUsd(value),
    gain: formatSignedUsd(gain),
    gainValue: gain,
    gainRate: cost > 0 ? Math.round((gain / cost) * 1000) / 10 : null
  };
}

function estimateAssetNativeValue(asset: AssetValuation) {
  if (asset.quantity !== null) {
    if (asset.currentValue !== null) return asset.currentValue * asset.quantity;
    if (asset.averageCost !== null) return asset.averageCost * asset.quantity;
  }

  return asset.currentValue ?? 0;
}

function estimateAssetNativeCost(asset: AssetValuation) {
  if (asset.quantity !== null && asset.averageCost !== null) {
    return asset.quantity * asset.averageCost;
  }

  return estimateAssetNativeValue(asset);
}

function assetPayload(form: AssetForm) {
  const { isSaleRestricted, ...payload } = form;
  const isKrwAsset = form.currency === "KRW" && form.market !== "other";

  return {
    ...payload,
    liquidFrom: liquidFromForSaleRestrictionForm(form),
    ticker: form.ticker.trim() || null,
    quantity: toNumberOrNull(form.quantity),
    averageCost: toNumberOrNull(form.averageCost),
    currentValue: toNumberOrNull(form.currentValue),
    purchaseFxRateToKrw: isKrwAsset ? 1 : Number(form.purchaseFxRateToKrw || 1),
    fxRateToKrw: isKrwAsset ? 1 : Number(form.fxRateToKrw || 1),
    maturityDate: form.type === "bond" && form.maturityDate ? form.maturityDate : null,
    maturityAmount: form.type === "bond" ? toNumberOrNull(form.maturityAmount) : null,
    maturityCurrency: form.type === "bond" ? (form.maturityCurrency || form.currency).toUpperCase() : null,
    maturityFxRateToKrw:
      form.type === "bond"
        ? (form.maturityCurrency || form.currency) === "KRW"
          ? 1
          : Number(form.maturityFxRateToKrw || form.fxRateToKrw || 1)
        : null,
    autoConvertOnMaturity: form.type === "bond" ? form.autoConvertOnMaturity : true
  };
}

function assetLinkagePayload(asset: AssetValuation, form: AssetForm, updateSaleRestriction = false) {
  const isKrwAsset = form.currency === "KRW" && form.market !== "other";

  return {
    accountId: asset.accountId,
    type: form.type,
    name: asset.name,
    market: form.market,
    ticker: form.ticker.trim() || null,
    currency: form.currency,
    quantity: asset.quantity,
    averageCost: asset.averageCost,
    currentValue: asset.currentValue,
    valuationDate: asset.valuationDate,
    purchaseFxRateToKrw: isKrwAsset ? 1 : Number(form.purchaseFxRateToKrw || asset.purchaseFxRateToKrw || 1),
    fxRateToKrw: isKrwAsset ? 1 : Number(form.fxRateToKrw || asset.fxRateToKrw || 1),
    liquidFrom: updateSaleRestriction ? liquidFromForSaleRestrictionLot(asset, form) : asset.liquidFrom,
    maturityDate: asset.maturityDate,
    maturityAmount: asset.maturityAmount,
    maturityCurrency: asset.maturityCurrency,
    maturityFxRateToKrw: asset.maturityFxRateToKrw,
    autoConvertOnMaturity: asset.autoConvertOnMaturity,
    notes: asset.notes
  };
}

function buyTransactionPayload(form: AssetForm) {
  const payload = assetPayload(form);
  const amount = payload.quantity !== null && payload.averageCost !== null ? null : payload.currentValue;
  return {
    transactionType: "buy",
    accountId: payload.accountId,
    type: payload.type,
    name: payload.name,
    market: payload.market,
    ticker: payload.ticker,
    currency: payload.currency,
    quantity: payload.quantity,
    price: payload.averageCost,
    amount,
    currentValue: payload.currentValue ?? payload.averageCost,
    transactionDate: payload.valuationDate,
    purchaseFxRateToKrw: payload.purchaseFxRateToKrw,
    fxRateToKrw: payload.fxRateToKrw,
    liquidFrom: payload.liquidFrom,
    maturityDate: payload.maturityDate,
    maturityAmount: payload.maturityAmount,
    maturityCurrency: payload.maturityCurrency,
    maturityFxRateToKrw: payload.maturityFxRateToKrw,
    autoConvertOnMaturity: payload.autoConvertOnMaturity,
    notes: payload.notes
  };
}

function targetSelectionMessage(mode: TransactionMode, form: AssetForm) {
  if (mode === "buy" && !form.accountId) {
    return "계좌를 선택해 주세요.";
  }

  if (mode !== "buy" && !form.positionKey) {
    return "보유 자산을 선택해 주세요.";
  }

  return "";
}

function sellTransactionPayload(form: AssetForm) {
  return {
    transactionType: "sell",
    positionKey: form.positionKey,
    quantity: toNumberOrNull(form.quantity),
    price: toNumberOrNull(form.currentValue),
    currency: form.currency,
    fxRateToKrw: Number(form.fxRateToKrw || 1),
    transactionDate: form.valuationDate,
    notes: form.notes
  };
}

function dividendTransactionPayload(form: AssetForm) {
  return {
    transactionType: "dividend",
    positionKey: form.positionKey,
    amount: toNumberOrNull(form.currentValue),
    currency: form.currency,
    fxRateToKrw: Number(form.fxRateToKrw || 1),
    transactionDate: form.valuationDate,
    notes: form.notes
  };
}

function formFromAsset(asset: AssetValuation, lots: AssetValuation[] = [asset]): AssetForm {
  const saleRestriction = assetSaleRestrictionFormState(lots);

  return {
    accountId: asset.accountId,
    type: asset.type,
    name: asset.name,
    market: asset.market,
    ticker: asset.ticker ?? "",
    currency: asset.currency,
    quantity: asset.quantity?.toString() ?? "",
    averageCost: asset.averageCost?.toString() ?? "",
    currentValue: asset.currentValue?.toString() ?? "",
    valuationDate: asset.valuationDate,
    purchaseFxRateToKrw: asset.purchaseFxRateToKrw.toString(),
    fxRateToKrw: asset.fxRateToKrw.toString(),
    isSaleRestricted: saleRestriction.isSaleRestricted,
    liquidFrom: saleRestriction.liquidFrom || asset.liquidFrom,
    maturityDate: asset.maturityDate ?? "",
    maturityAmount: asset.maturityAmount?.toString() ?? "",
    maturityCurrency: asset.maturityCurrency ?? asset.currency,
    maturityFxRateToKrw: (asset.maturityFxRateToKrw ?? asset.fxRateToKrw).toString(),
    autoConvertOnMaturity: asset.autoConvertOnMaturity,
    maturedAt: asset.maturedAt,
    notes: asset.notes ?? "",
    assetId: asset.id,
    positionKey: assetAggregationKey(asset)
  };
}

function formFromSelectedPosition(form: AssetForm, positions: AssetPosition[], positionKey: string): AssetForm {
  const position = positions.find((item) => item.positionKey === positionKey);
  if (!position) return { ...form, positionKey };

  return {
    ...form,
    positionKey,
    assetId: position.lotIds[0] ?? "",
    accountId: position.accountId,
    type: position.type,
    name: position.name,
    market: position.market,
    ticker: position.ticker ?? "",
    currency: position.currency,
    averageCost: position.averageCost?.toString() ?? "",
    fxRateToKrw: position.fxRateToKrw.toString(),
    purchaseFxRateToKrw: position.purchaseFxRateToKrw.toString()
  };
}

function formFromTransaction(transaction: AssetTransaction, positions: AssetPosition[], accounts: Account[], assets: AssetValuation[]): AssetForm {
  const linkedAsset = transaction.assetId ? assets.find((asset) => asset.id === transaction.assetId) ?? null : null;
  const position =
    positions.find((item) => item.positionKey === transaction.positionKey) ??
    positions.find((item) => item.lotIds.includes(transaction.assetId ?? ""));

  const base = transaction.transactionType === "buy" && linkedAsset
    ? formFromAsset(linkedAsset)
    : position
      ? formFromSelectedPosition(emptyAssetForm, positions, position.positionKey)
      : emptyAssetForm;
  return {
    ...base,
    accountId: transaction.accountId || base.accountId || chooseAccountId(accounts),
    type: linkedAsset?.type ?? position?.type ?? base.type,
    market: linkedAsset?.market ?? position?.market ?? base.market,
    name: linkedAsset?.name ?? position?.name ?? transaction.assetName ?? "",
    ticker: linkedAsset?.ticker ?? position?.ticker ?? transaction.ticker ?? "",
    currency: transaction.currency,
    quantity: transaction.quantity?.toString() ?? "",
    averageCost: transaction.transactionType === "buy" ? transaction.price?.toString() ?? "" : base.averageCost,
    currentValue:
      transaction.transactionType === "buy"
        ? linkedAsset?.currentValue?.toString() ?? transaction.price?.toString() ?? ""
        : transaction.transactionType === "dividend"
          ? transaction.amount?.toString() ?? ""
          : transaction.price?.toString() ?? "",
    valuationDate: transaction.transactionDate,
    fxRateToKrw: transaction.transactionType === "buy" ? linkedAsset?.fxRateToKrw.toString() ?? transaction.fxRateToKrw.toString() : transaction.fxRateToKrw.toString(),
    purchaseFxRateToKrw:
      transaction.transactionType === "buy" ? transaction.fxRateToKrw.toString() : base.purchaseFxRateToKrw,
    liquidFrom: base.liquidFrom || transaction.transactionDate,
    notes: transaction.notes ?? "",
    assetId: transaction.assetId ?? base.assetId,
    positionKey: transaction.positionKey ?? base.positionKey
  };
}

function estimateSellGain(asset: AssetPosition | AssetValuation, form: AssetForm) {
  const quantity = toNumberOrNull(form.quantity) ?? 0;
  const sellPrice = toNumberOrNull(form.currentValue) ?? 0;
  const fxRate = Number(form.fxRateToKrw || asset.fxRateToKrw || 1);
  const cost = quantity * (asset.averageCost ?? 0) * asset.purchaseFxRateToKrw;
  const proceeds = quantity * sellPrice * fxRate;
  return Math.round(proceeds - cost);
}

function estimateSellRate(asset: AssetPosition, form: AssetForm) {
  const quantity = toNumberOrNull(form.quantity) ?? 0;
  const cost = quantity * (asset.averageCost ?? 0) * asset.purchaseFxRateToKrw;
  if (cost <= 0) return null;
  return Math.round((estimateSellGain(asset, form) / cost) * 1000) / 10;
}

function estimateMaturityGain(form: AssetForm) {
  const maturityAmount = toNumberOrNull(form.maturityAmount) ?? 0;
  const maturityCurrency = form.maturityCurrency || form.currency;
  const maturityFxRate = maturityCurrency === "KRW" ? 1 : Number(form.maturityFxRateToKrw || form.fxRateToKrw || 1);
  const quantity = toNumberOrNull(form.quantity) ?? 0;
  const averageCost = toNumberOrNull(form.averageCost) ?? 0;
  const purchaseFxRate = form.currency === "KRW" ? 1 : Number(form.purchaseFxRateToKrw || 1);
  const costKrw =
    quantity > 0 && averageCost > 0
      ? quantity * averageCost * purchaseFxRate
      : (toNumberOrNull(form.currentValue) ?? 0) * purchaseFxRate;
  return Math.round(maturityAmount * maturityFxRate - costKrw);
}

function formatBondMaturityMeta(asset: AssetValuation) {
  const amount = formatNativeAmount(asset.maturityAmount ?? 0, asset.maturityCurrency ?? asset.currency);
  const gain = formatSignedKrw(estimateAssetMaturityGain(asset));
  const days = daysUntil(asset.maturityDate);
  const dayText = days === null ? "" : days < 0 ? " · 만기 도래" : ` · D-${days}`;
  const status = asset.maturedAt ? " · 만기 상환 완료" : "";
  return `만기 ${asset.maturityDate} · 상환 ${amount} · 확정손익 ${gain}${dayText}${status}`;
}

function estimateAssetMaturityGain(asset: AssetValuation) {
  const amount = asset.maturityAmount ?? 0;
  const fxRate = asset.maturityCurrency === "KRW" ? 1 : asset.maturityFxRateToKrw ?? asset.fxRateToKrw;
  return Math.round(amount * fxRate - asset.costKrw);
}

function daysUntil(dateValue: string | null) {
  if (!dateValue) return null;
  const target = Date.parse(`${dateValue}T00:00:00.000Z`);
  const now = Date.parse(`${today}T00:00:00.000Z`);
  return Math.ceil((target - now) / 86_400_000);
}

function toNumberOrNull(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function chooseAccountId(accounts: Account[], preferredAccountId?: string) {
  if (preferredAccountId && accounts.some((account) => account.id === preferredAccountId)) {
    return preferredAccountId;
  }

  return accounts[0]?.id ?? "";
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0
  }).format(value);
}

function formatKrwThousands(value: number) {
  if (Math.abs(value) < 1000) {
    return formatKrw(value);
  }

  const sign = value < 0 ? "-" : "";
  const thousands = Math.round(Math.abs(value) / 1000);
  return `${sign}₩${thousands.toLocaleString("ko-KR")}k`;
}

function formatSignedKrwThousands(value: number) {
  if (value > 0) return `+${formatKrwThousands(value)}`;
  return formatKrwThousands(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatSignedUsd(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatUsd(value)}`;
}

function compactKrw(value: number) {
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}만`;
  }
  return value.toLocaleString("ko-KR");
}

function formatAxisKrw(value: number) {
  if (value === 0) return "0";
  return compactKrw(Math.round(value));
}

function compactSignedKrw(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${compactKrw(value)}`;
}

function formatSignedKrw(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatKrw(value)}`;
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

function formatQuantity(value: number) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
}

function quantityInputValue(value: number) {
  return roundNumber(value, 6).toString();
}

function formatDisplayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}.${month}.${day}`;
}

function formatDisplayDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDisplayMonth(value: string) {
  const [year, month] = value.split("-");
  return `${year}.${month}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(value: string, months: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function minDate(first: string, second: string) {
  return first < second ? first : second;
}

function maxDate(dates: string[]) {
  return dates.reduce((max, date) => (date > max ? date : max));
}

function gainClass(value: number) {
  if (value > 0) return "gain positive";
  if (value < 0) return "gain negative";
  return "gain";
}

function localDateString() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}
