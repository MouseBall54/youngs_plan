import { FormEvent, PointerEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Landmark,
  LineChart,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  WalletCards,
  X
} from "lucide-react";
import {
  createAccount,
  createAsset,
  createTransaction,
  deleteAccount,
  deleteAsset,
  deleteTransaction,
  fetchPositions,
  fetchTransactions,
  fetchAccounts,
  fetchHistory,
  fetchSummary,
  fetchUsdKrwRate,
  refreshPrices,
  searchTickers,
  updateAccount,
  updateAsset,
  updateTransaction
} from "./api";
import type {
  Account,
  AssetPosition,
  AssetTransaction,
  AssetMarket,
  AssetType,
  AssetValuation,
  BreakdownItem,
  HistoryPoint,
  PriceSource,
  Summary,
  TickerSearchResult,
  TransactionType
} from "./types";

const assetLabels: Record<AssetType, string> = {
  stock: "주식",
  real_estate: "부동산",
  cash: "현금",
  bond: "채권",
  dividend: "배당"
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

const transactionLabels: Record<TransactionType, string> = {
  buy: "매수",
  sell: "매도",
  dividend: "배당",
  maturity: "만기"
};

const priceSourceLabels: Record<PriceSource, string> = {
  manual: "수동 입력",
  yahoo: "Yahoo 시세",
  stooq: "Stooq 시세"
};

const editableTransactionLabels: Record<TransactionMode, string> = {
  buy: "매수",
  sell: "매도",
  dividend: "배당"
};

const today = localDateString();

type Tab = "overview" | "assets" | "accounts";
type TransactionMode = "buy" | "sell" | "dividend";

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

export function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [positions, setPositions] = useState<AssetPosition[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [transactions, setTransactions] = useState<AssetTransaction[]>([]);
  const [targetDate, setTargetDate] = useState(today);
  const [range, setRange] = useState("1m");
  const [trendView, setTrendView] = useState("chart");
  const [status, setStatus] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isSavingAsset, setIsSavingAsset] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [isSearchingTickers, setIsSearchingTickers] = useState(false);
  const [isLoadingFx, setIsLoadingFx] = useState(false);
  const [transactionMode, setTransactionMode] = useState<TransactionMode>("buy");
  const [showKrwForUsd, setShowKrwForUsd] = useState(false);
  const [assetSearchInput, setAssetSearchInput] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [assetAccountFilter, setAssetAccountFilter] = useState("all");
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetType | "all">("all");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [tickerResults, setTickerResults] = useState<TickerSearchResult[]>([]);
  const [accountForm, setAccountForm] = useState({ name: "", institution: "" });
  const [assetForm, setAssetForm] = useState<AssetForm>(emptyAssetForm);

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

  async function load(preferredAccountId?: string) {
    try {
      setStatus("");
      const [nextAccounts, nextSummary, nextPositions, nextHistory, nextTransactions] = await Promise.all([
        fetchAccounts(),
        fetchSummary(targetDate),
        fetchPositions(targetDate),
        fetchHistory(targetDate, range),
        fetchTransactions()
      ]);
      setAccounts(nextAccounts);
      setSummary(nextSummary);
      setPositions(nextPositions);
      setHistory(nextHistory.points);
      setTransactions(nextTransactions);
      setAssetForm((current) => ({
        ...current,
        accountId: chooseAccountId(nextAccounts, preferredAccountId ?? current.accountId)
      }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    void load();
  }, [targetDate, range]);

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

  const tickerAssets = useMemo(() => summary?.assets.filter((asset) => asset.ticker) ?? [], [summary]);
  const displayedAssets = useMemo(() => aggregateAssetRows(summary?.assets ?? []), [summary]);
  const filteredAssets = useMemo(
    () => filterAssetRows(displayedAssets, assetSearch, assetAccountFilter, assetTypeFilter),
    [displayedAssets, assetSearch, assetAccountFilter, assetTypeFilter]
  );

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    try {
      setFeedback("");
      setStatus("");
      setIsSavingAccount(true);
      const account = editingAccountId
        ? await updateAccount(editingAccountId, accountForm)
        : await createAccount(accountForm);
      setEditingAccountId(null);
      setAccountForm({ name: "", institution: "" });
      setFeedback(`계좌 "${account.name}" ${editingAccountId ? "수정" : "등록"} 완료`);
      await load(account.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "계좌를 저장하지 못했습니다.");
    } finally {
      setIsSavingAccount(false);
    }
  }

  async function submitAsset(event: FormEvent) {
    event.preventDefault();
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
        const payload = assetPayload(assetForm);
        await updateAsset(editingAssetId, payload);
      } else if (transactionMode === "buy") {
        await createTransaction(transactionPayload);
      } else if (transactionMode === "sell") {
        await createTransaction(transactionPayload);
      } else {
        await createTransaction(transactionPayload);
      }
      setAssetForm((current) => ({
        ...emptyAssetForm,
        accountId: chooseAccountId(accounts, current.accountId)
      }));
      setEditingAssetId(null);
      setEditingTransactionId(null);
      setFeedback(`${transactionLabels[transactionMode]} ${editingAssetId || editingTransactionId ? "수정" : "등록"} 완료`);
      await load();
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
      await load();
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
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "계좌를 삭제하지 못했습니다.");
    }
  }

  async function updateTickerPrices() {
    try {
      setStatus("");
      setFeedback("");
      setIsRefreshingPrices(true);
      const result = await refreshPrices();
      const successCount = result.results.filter((item) => item.ok).length;
      const failCount = result.results.length - successCount;
      setFeedback(`가격 업데이트 완료: 성공 ${successCount}개${failCount ? `, 실패 ${failCount}개` : ""}`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "가격을 업데이트하지 못했습니다.");
    } finally {
      setIsRefreshingPrices(false);
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
    setEditingAssetId(asset.id);
    setEditingTransactionId(null);
    setAssetForm(formFromAsset(asset));
    setTab("assets");
  }

  function startTransactionEdit(transaction: AssetTransaction) {
    if (transaction.transactionType === "maturity") {
      setStatus("만기 상환 거래는 삭제로 되돌린 뒤 채권 정보를 수정할 수 있습니다.");
      return;
    }
    setEditingAssetId(null);
    setEditingTransactionId(transaction.id);
    setTransactionMode(transaction.transactionType);
    setAssetForm(formFromTransaction(transaction, positions, accounts));
    setTickerResults([]);
    setTab("assets");
  }

  async function removeTransaction(transaction: AssetTransaction) {
    if (!window.confirm(`${transactionLabels[transaction.transactionType]} 거래를 삭제할까요?`)) return;
    try {
      setStatus("");
      await deleteTransaction(transaction.id);
      if (editingTransactionId === transaction.id) {
        setEditingTransactionId(null);
        setAssetForm({ ...emptyAssetForm, accountId: chooseAccountId(accounts, assetForm.accountId) });
      }
      setFeedback("거래 삭제 완료");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "거래를 삭제하지 못했습니다.");
    }
  }

  function startAccountEdit(account: Account) {
    setEditingAccountId(account.id);
    setAccountForm({ name: account.name, institution: account.institution ?? "" });
    setTab("accounts");
  }

  function resetAssetForm() {
    setEditingAssetId(null);
    setEditingTransactionId(null);
    setAssetForm({ ...emptyAssetForm, accountId: chooseAccountId(accounts, assetForm.accountId) });
  }

  function resetAccountForm() {
    setEditingAccountId(null);
    setAccountForm({ name: "", institution: "" });
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
          onClick={() => void load()}
          aria-label="데이터 새로고침"
          title="데이터 새로고침"
        >
          <RefreshCw size={20} />
          <span>데이터</span>
        </button>
      </header>

      <section className="controlBar">
        <label>
          <CalendarDays size={17} />
          <input
            name="targetDate"
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => void updateTickerPrices()} disabled={!tickerAssets.length || isRefreshingPrices}>
          <RefreshCw size={16} />
          {isRefreshingPrices ? "업데이트 중" : "시세"}
        </button>
      </section>

      {status && <Notice message={status} onDismiss={() => setStatus("")} />}
      {feedback && <Notice message={feedback} tone="success" onDismiss={() => setFeedback("")} />}

      {tab === "overview" && (
        <>
          <section className="heroCard">
            <div>
              <span>총 평가액</span>
              <strong>{formatKrw(summary?.totalValueKrw ?? 0)}</strong>
              <p className={gainClass(summary?.totalGainKrw ?? 0)}>
                총수익 {formatSignedKrw(summary?.totalIncomeKrw ?? summary?.totalGainKrw ?? 0)} · 평가 {formatPercent(summary?.totalGainRate)}
              </p>
            </div>
            <div className="liquidBadge">
              <Banknote size={18} />
              현금화 {formatPercent(summary?.liquidRatio ?? 0)}
            </div>
          </section>

          <section className="metricGrid">
            <Metric title="현금화 가능" value={compactKrw(summary?.liquidValueKrw ?? 0)} icon={<CircleDollarSign />} />
            <Metric title="묶인 자산" value={compactKrw(summary?.lockedValueKrw ?? 0)} icon={<Landmark />} />
            <Metric title="원금" value={compactKrw(summary?.totalCostKrw ?? 0)} icon={<WalletCards />} />
            <Metric title="평가손익" value={compactSignedKrw(summary?.unrealizedGainKrw ?? 0)} icon={<LineChart />} />
            <Metric title="차익실현" value={compactSignedKrw(summary?.realizedGainKrw ?? 0)} icon={<Banknote />} />
            <Metric title="배당수익" value={compactSignedKrw(summary?.dividendIncomeKrw ?? 0)} icon={<CircleDollarSign />} />
          </section>

          <section className="panel chartPanel">
            <div className="sectionHeader">
              <div>
                <h2>기간별 추이</h2>
                <span>매도 가능일 기준 현금화 가능/묶인 자산</span>
              </div>
              <div className="sectionControls">
                <Segmented options={{ chart: "그래프", table: "테이블" }} value={trendView} onChange={setTrendView} />
                <Segmented options={rangeLabels} value={range} onChange={setRange} />
              </div>
            </div>
            {trendView === "chart" ? (
              <TimelineChart points={history} />
            ) : (
              <LiquidityReleaseTable assets={summary?.assets ?? []} points={history} />
            )}
          </section>

          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>자산 점유율</h2>
                <span>전체 평가액 기준</span>
              </div>
            </div>
            <AllocationPie items={summary?.byTypeDetails ?? []} labels={assetLabels} />
          </section>

          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>자산 구분</h2>
                <span>비중과 수익률</span>
              </div>
            </div>
            <BreakdownList items={summary?.byTypeDetails ?? []} labels={assetLabels} />
          </section>

          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>계좌 구분</h2>
                <span>계좌별 평가액</span>
              </div>
            </div>
            <BreakdownList items={summary?.byAccountDetails ?? []} />
          </section>
        </>
      )}

      {tab === "assets" && (
        <>
          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>{editingAssetId || editingTransactionId ? "거래 수정" : "거래 등록"}</h2>
                <span>매수, 매도, 배당을 기록해 보유 수량과 수익을 관리합니다.</span>
              </div>
              {(editingAssetId || editingTransactionId) && (
                <button className="textButton" type="button" onClick={resetAssetForm}>
                  신규 입력
                </button>
              )}
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
                setAssetForm((current) => ({ ...emptyAssetForm, accountId: chooseAccountId(accounts, current.accountId) }));
              }}
              onChange={setAssetForm}
              onSearchTicker={() => void searchTickerCandidates()}
              onSelectTicker={selectTicker}
              onSubmit={submitAsset}
            />
          </section>

          <section className="panel">
            <div className="sectionHeader">
              <div>
                <h2>자산 목록</h2>
                <span>
                  {filteredAssets.length}개
                  {(summary?.assets.length ?? 0) > displayedAssets.length ? ` · 매수 ${summary?.assets.length ?? 0}건` : ""}
                </span>
              </div>
              <button className="textButton" type="button" onClick={() => setShowKrwForUsd((current) => !current)}>
                {showKrwForUsd ? "달러 보기" : "원/달러 보기"}
              </button>
            </div>
            <div className="assetListFilters">
              <div className="assetSearchBox">
                <input
                  name="assetSearch"
                  placeholder="자산 찾기"
                  value={assetSearchInput}
                  onChange={(event) => setAssetSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setAssetSearch(assetSearchInput);
                    }
                  }}
                />
                <button type="button" onClick={() => setAssetSearch(assetSearchInput)}>
                  <Search size={16} />
                  찾기
                </button>
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
            </div>
            <AssetList
              assets={filteredAssets}
              showKrwForUsd={showKrwForUsd}
              onEdit={startAssetEdit}
              onDelete={(asset) => void removeAsset(asset)}
            />
          </section>

          <section className="panel">
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
            <form className="compactForm" onSubmit={(event) => void submitAccount(event)}>
              <input
                required
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
        <TabButton active={tab === "assets"} icon={<LineChart />} label="자산" onClick={() => setTab("assets")} />
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

function AssetFormView({
  accounts,
  assets,
  positions,
  mode,
  form,
  isSaving,
  isSearchingTickers,
  isLoadingFx,
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

  return (
    <form className="assetForm" onSubmit={onSubmit}>
      <div className="transactionMode">
        <Segmented options={editableTransactionLabels} value={mode} onChange={(value) => onModeChange(value as TransactionMode)} />
      </div>
      {mode !== "buy" && (
        <>
          <input
            className="assetPickerSearch"
            name="assetPickerSearch"
            placeholder="보유 자산 검색"
            value={assetPickerSearch}
            onChange={(event) => setAssetPickerSearch(event.target.value)}
          />
          <select
            name="positionKey"
            required
            value={form.positionKey}
            onChange={(event) => onChange(formFromSelectedPosition(form, positions, event.target.value))}
          >
            <option value="">보유 자산 선택</option>
            {form.positionKey && !selectedPosition && (
              <option value={form.positionKey}>{form.name || "기존 거래 포지션"}</option>
            )}
            {selectablePositions.map((position) => (
              <option key={position.positionKey} value={position.positionKey}>
                {position.name} · {position.accountName} · {position.quantity?.toLocaleString("ko-KR") ?? "-"}주 · 평균{" "}
                {formatNativeAmount(position.averageCost ?? 0, position.currency)}
              </option>
            ))}
          </select>
          {selectedPosition && (
            <div className="tradePreview">
              <span>보유 {selectedPosition.quantity?.toLocaleString("ko-KR") ?? "-"}주 · {selectedPosition.lotCount}건 통합</span>
              <span>
                평균단가 {formatNativeAmount(selectedPosition.averageCost ?? 0, selectedPosition.currency)} · 현재가{" "}
                {formatNativeAmount(selectedPosition.currentValue ?? 0, selectedPosition.currency)}
              </span>
              <span>현재 평가액 {formatKrw(selectedPosition.valueKrw)}</span>
              {mode === "sell" ? (
                <b className={gainClass(estimatedSellGain ?? 0)}>
                  예상 실현손익 {formatSignedKrw(estimatedSellGain ?? 0)} · {formatPercent(estimatedSellRate)}
                </b>
              ) : (
                <b>배당수익 {formatKrw(estimatedDividend * fxRate)}</b>
              )}
            </div>
          )}
        </>
      )}
      {mode === "buy" && (
        <>
      <select name="accountId" required value={form.accountId} onChange={(event) => onChange({ ...form, accountId: event.target.value })}>
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
      <div className="tickerField">
        <input
          name="ticker"
          placeholder="티커 예: AAPL, 005930.KS"
          value={form.ticker}
          onChange={(event) => onChange({ ...form, ticker: event.target.value.toUpperCase() })}
        />
      </div>
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
        </>
      )}
      <div className="priceQuantityGrid">
        {mode === "buy" && (
          <input
            inputMode="decimal"
            name="averageCost"
            placeholder="평균단가"
            value={form.averageCost}
            onChange={(event) => onChange({ ...form, averageCost: event.target.value })}
          />
        )}
        <input
          inputMode="decimal"
          name={mode === "dividend" ? "dividendAmount" : mode === "sell" ? "sellPrice" : "currentValue"}
          placeholder={mode === "dividend" ? "배당금" : mode === "sell" ? "매도단가" : form.ticker || form.quantity ? "현재가" : "평가액"}
          value={form.currentValue}
          onChange={(event) => onChange({ ...form, currentValue: event.target.value })}
        />
        {mode !== "dividend" && (
          <input
            inputMode="decimal"
            name="quantity"
            placeholder="수량"
            max={mode === "sell" ? selectedPosition?.quantity ?? undefined : undefined}
            value={form.quantity}
            onChange={(event) => onChange({ ...form, quantity: event.target.value })}
          />
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
            현재 환율
            <input
              inputMode="decimal"
              name="fxRateToKrw"
              value={form.fxRateToKrw}
              onChange={(event) => onChange({ ...form, fxRateToKrw: event.target.value })}
            />
          </label>
          <span>{isLoadingFx ? "환율 자동 조회 중" : "매수일/현재 기준 자동 반영"}</span>
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
      <label className="dateInput">
        {mode === "sell" ? "매도일" : mode === "dividend" ? "배당일" : "매수일"}
        <input
          name="valuationDate"
          type="date"
          value={form.valuationDate}
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
              <div className="tradePreview">
                <span>예상 만기 상환 {formatNativeAmount(toNumberOrNull(form.maturityAmount) ?? 0, form.maturityCurrency || form.currency)}</span>
                <b className={gainClass(estimateMaturityGain(form))}>예상 확정손익 {formatSignedKrw(estimateMaturityGain(form))}</b>
              </div>
            </div>
          )}
        </>
      )}
      <textarea name="notes" placeholder="메모" value={form.notes} onChange={(event) => onChange({ ...form, notes: event.target.value })} />
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
              {asset.type === "bond" && asset.maturityDate && <span>{formatBondMaturityMeta(asset)}</span>}
              <span>{priceSourceLabel(asset.priceSource)}</span>
              {asset.lastPriceError && <span className="errorText">{asset.lastPriceError}</span>}
            </div>
            {canModify ? (
              <div className="rowActions">
                <button type="button" onClick={() => onEdit(asset)} aria-label={`${asset.name} 수정`}>
                  <Pencil size={16} />
                </button>
                <button type="button" onClick={() => onDelete(asset)} aria-label={`${asset.name} 삭제`}>
                  <Trash2 size={16} />
                </button>
              </div>
            ) : (
              <span className="aggregateBadge">{lotCount}건 합산</span>
            )}
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
  if (transactions.length === 0) {
    return <span className="emptyText">거래 이력이 없습니다.</span>;
  }

  return (
    <div className="transactionList">
      {transactions.slice(0, 8).map((transaction) => {
        const income =
          transaction.transactionType === "dividend" ? transaction.dividendIncomeKrw : transaction.realizedGainKrw;
        return (
          <article className="transactionItem" key={transaction.id}>
            <div>
              <strong>
                {transactionLabels[transaction.transactionType]} · {transaction.assetName ?? "자산"}
              </strong>
              <span>
                {transaction.transactionDate} · {transaction.accountName}
                {transaction.quantity !== null ? ` · ${transaction.quantity.toLocaleString("ko-KR")}주` : ""}
              </span>
            </div>
            <b className={gainClass(income)}>
              {transaction.transactionType === "buy" ? formatKrw((transaction.amount ?? 0) * transaction.fxRateToKrw) : formatSignedKrw(income)}
            </b>
            <div className="rowActions">
              {transaction.transactionType !== "maturity" && (
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
    </div>
  );
}

function TimelineChart({ points }: { points: HistoryPoint[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 340;
  const height = 170;
  const paddingX = 20;
  const topPadding = 16;
  const bottomPadding = 24;
  const chartBottom = height - bottomPadding;
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.totalValueKrw, point.liquidValueKrw]));
  const xStep = points.length > 1 ? (width - paddingX * 2) / (points.length - 1) : 0;
  const toX = (index: number) => (points.length > 1 ? paddingX + index * xStep : width / 2);
  const toY = (value: number) => chartBottom - (value / maxValue) * (chartBottom - topPadding);
  const totalLine = points.map((point, index) => `${toX(index)},${toY(point.totalValueKrw)}`).join(" ");
  const liquidLine = points.map((point, index) => `${toX(index)},${toY(point.liquidValueKrw)}`).join(" ");
  const totalArea = areaPoints(points.map((point, index) => [toX(index), toY(point.totalValueKrw)]), chartBottom);
  const liquidArea = areaPoints(points.map((point, index) => [toX(index), toY(point.liquidValueKrw)]), chartBottom);
  const latest = points[points.length - 1];
  const axisPoints = chartAxisPoints(points);
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const activeX = activeIndex === null ? 0 : toX(activeIndex);
  const labelX = activeX > width / 2 ? activeX - 120 : activeX + 8;
  const gridLines = [0.25, 0.5, 0.75].map((ratio) => topPadding + (chartBottom - topPadding) * ratio);

  function selectPoint(event: PointerEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(paddingX, Math.min(width - paddingX, ((event.clientX - rect.left) / rect.width) * width));
    const index = points.length > 1 ? Math.round((x - paddingX) / (xStep || 1)) : 0;
    setActiveIndex(Math.max(0, Math.min(points.length - 1, index)));
  }

  if (points.length === 0) {
    return <span className="emptyText">표시할 추이 데이터가 없습니다.</span>;
  }

  return (
    <div className="chartWrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="자산 추이 그래프"
        onPointerDown={selectPoint}
        onPointerMove={(event) => {
          if (event.buttons > 0 || event.pointerType === "touch") selectPoint(event);
        }}
        onPointerLeave={() => setActiveIndex(null)}
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
          {gridLines.map((y) => (
            <line key={y} x1={paddingX} x2={width - paddingX} y1={y} y2={y} />
          ))}
          <line x1={paddingX} x2={width - paddingX} y1={chartBottom} y2={chartBottom} />
        </g>
        {points.length > 1 && <polygon points={totalArea} className="totalArea" />}
        {points.length > 1 && <polygon points={liquidArea} className="liquidArea" />}
        <polyline points={totalLine} className="totalLine" vectorEffect="non-scaling-stroke" />
        <polyline points={liquidLine} className="liquidLine" vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => (
          <circle className="chartMarker" key={point.date} cx={toX(index)} cy={toY(point.liquidValueKrw)} r="1.7" />
        ))}
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
            <span>묶임 {formatKrw(row.point?.lockedValueKrw ?? 0)}</span>
            <span>해제분 {formatKrw(row.releasedValueKrw)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function chartAxisPoints(points: HistoryPoint[]) {
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

function areaPoints(points: number[][], bottomY: number) {
  if (points.length === 0) return "";

  const first = points[0];
  const last = points[points.length - 1];
  return [`${first[0]},${bottomY}`, ...points.map(([x, y]) => `${x},${y}`), `${last[0]},${bottomY}`].join(" ");
}

function AllocationPie({ items, labels = {} }: { items: BreakdownItem[]; labels?: Record<string, string> }) {
  const visibleItems = items.filter((item) => item.valueKrw > 0);
  const total = visibleItems.reduce((sum, item) => sum + item.valueKrw, 0);
  const colors = ["#17456b", "#28715b", "#b86b3c", "#6d5bd0", "#9a4d57", "#5d7180"];
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
          const circle = (
            <circle
              key={item.key}
              cx="60"
              cy="60"
              r="42"
              stroke={colors[index % colors.length]}
              strokeDasharray={`${length} ${263.89 - length}`}
              strokeDashoffset={offset}
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
      <div className="pieLegend">
        {visibleItems.map((item, index) => (
          <div key={item.key}>
            <span>
              <i style={{ background: colors[index % colors.length] }} />
              {labels[item.key] ?? item.label}
            </span>
            <b>{formatPercent(item.share)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function BreakdownList({ items, labels = {} }: { items: BreakdownItem[]; labels?: Record<string, string> }) {
  if (items.length === 0) {
    return <span className="emptyText">등록된 자산 없음</span>;
  }

  return (
    <div className="breakdownList">
      {items.map((item) => (
        <div className="breakdownRow" key={item.key}>
          <div className="breakdownTop">
            <strong>{labels[item.key] ?? item.label}</strong>
            <span>{formatPercent(item.share)}</span>
          </div>
          <div className="barTrack">
            <span style={{ width: `${Math.min(100, item.share)}%` }} />
          </div>
          <div className="breakdownBottom">
            <span>{formatKrw(item.valueKrw)}</span>
            <b className={gainClass(item.gainKrw)}>{formatPercent(item.gainRate)}</b>
          </div>
        </div>
      ))}
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

function Metric({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return (
    <article className="metric">
      <span>{icon}</span>
      <p>{title}</p>
      <strong>{value}</strong>
    </article>
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
    lotCount: group.length,
    lotIds: group.map((asset) => asset.id),
    firstValuationDate: sortedByDate[0].valuationDate,
    latestValuationDate: sortedByDate[sortedByDate.length - 1].valuationDate
  };
}

function assetAggregationKey(asset: AssetValuation) {
  const maturityPart = asset.type === "bond" && asset.maturityDate ? `:maturity:${asset.maturityDate}` : "";
  const identity = asset.ticker?.trim()
    ? `ticker:${asset.market}:${asset.ticker.trim().toUpperCase()}${maturityPart}`
    : `name:${asset.type}:${asset.market}:${asset.currency}:${normalizeAssetName(asset.name)}${maturityPart}`;

  return `${asset.accountId}:${identity}`;
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
    return asset.liquidFrom > latestDate ? `${purchaseText} · 매도 가능 ${asset.liquidFrom}` : purchaseText;
  }

  return asset.liquidFrom > asset.valuationDate ? `매도 가능 ${asset.liquidFrom}` : `매수일 ${asset.valuationDate}`;
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
    liquidFrom: isSaleRestricted ? form.liquidFrom : form.valuationDate,
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

function formFromAsset(asset: AssetValuation): AssetForm {
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
    isSaleRestricted: asset.liquidFrom > asset.valuationDate,
    liquidFrom: asset.liquidFrom,
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

function formFromTransaction(transaction: AssetTransaction, positions: AssetPosition[], accounts: Account[]): AssetForm {
  const position =
    positions.find((item) => item.positionKey === transaction.positionKey) ??
    positions.find((item) => item.lotIds.includes(transaction.assetId ?? ""));

  const base = position ? formFromSelectedPosition(emptyAssetForm, positions, position.positionKey) : emptyAssetForm;
  return {
    ...base,
    accountId: transaction.accountId || base.accountId || chooseAccountId(accounts),
    name: position?.name ?? transaction.assetName ?? "",
    ticker: position?.ticker ?? transaction.ticker ?? "",
    currency: transaction.currency,
    quantity: transaction.quantity?.toString() ?? "",
    averageCost: transaction.transactionType === "buy" ? transaction.price?.toString() ?? "" : base.averageCost,
    currentValue:
      transaction.transactionType === "dividend" ? transaction.amount?.toString() ?? "" : transaction.price?.toString() ?? "",
    valuationDate: transaction.transactionDate,
    fxRateToKrw: transaction.fxRateToKrw.toString(),
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

function formatDisplayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}.${month}.${day}`;
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
