import type { AssetMarket, AssetWithAccount, PriceSource, TickerSearchResult } from "./types.js";

export type MarketQuote = {
  price: number;
  date: string;
  symbol: string;
  source: Extract<PriceSource, "yahoo" | "stooq">;
};

export type FxQuote = {
  rate: number;
  date: string;
};

export type HistoricalMarketQuote = MarketQuote & {
  currency: string;
};

export type HistoricalFxQuote = FxQuote & {
  source: "yahoo";
};

export async function fetchLatestQuote(asset: Pick<AssetWithAccount, "ticker" | "market">): Promise<MarketQuote> {
  if (!asset.ticker?.trim()) {
    throw new Error("티커가 없습니다.");
  }

  const yahooQuote = await fetchYahooQuote(asset.ticker);
  if (yahooQuote) {
    return yahooQuote;
  }

  const symbol = normalizeStooqSymbol(asset.ticker, asset.market);
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`가격 조회 실패 (${response.status})`);
  }

  const text = await response.text();
  const quote = parseStooqQuote(text, symbol);

  if (!quote) {
    throw new Error("가격 데이터를 찾지 못했습니다.");
  }

  return quote;
}

export async function searchTickers(query: string, market: AssetMarket): Promise<TickerSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const localResults = market === "domestic" ? searchKoreanTickers(trimmed) : [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(trimmed)}&quotesCount=12&newsCount=0`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "youngs-plan/1.0"
    }
  }).catch(() => null);

  if (!response?.ok) {
    return localResults;
  }

  const body = (await response.json()) as {
    quotes?: Array<{
      symbol?: string;
      shortname?: string;
      longname?: string;
      exchange?: string;
      exchDisp?: string;
      quoteType?: string;
    }>;
  };

  const yahooResults = (body.quotes ?? [])
    .filter((quote) => quote.symbol && isEquityLike(quote.quoteType))
    .map((quote) => ({
      symbol: quote.symbol ?? "",
      name: quote.longname || quote.shortname || quote.symbol || "",
      exchange: quote.exchDisp || quote.exchange || null,
      market: inferMarket(quote.symbol ?? ""),
      currency: inferMarket(quote.symbol ?? "") === "us" ? "USD" : "KRW"
    }))
    .filter((quote) => quote.market === market)
    .slice(0, 8);

  return mergeTickerResults([...localResults, ...yahooResults]).slice(0, 8);
}

export async function fetchUsdKrwRate(date?: string): Promise<FxQuote> {
  const url = date ? yahooFxHistoryUrl(date) : "https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?range=5d&interval=1d";
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "youngs-plan/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`환율 조회 실패 (${response.status})`);
  }

  const body = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const result = body.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const timestamps = result?.timestamp ?? [];
  const targetTime = date ? Date.parse(`${date}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;

  for (let index = closes.length - 1; index >= 0; index -= 1) {
    const close = closes[index];
    const timestamp = (timestamps[index] ?? 0) * 1000;
    if (timestamp <= targetTime && close !== null && close !== undefined && Number.isFinite(close) && close > 0) {
      return {
        rate: close,
        date: new Date(timestamp).toISOString().slice(0, 10)
      };
    }
  }

  throw new Error("환율 데이터를 찾지 못했습니다.");
}

export async function fetchHistoricalQuotes(
  asset: Pick<AssetWithAccount, "ticker" | "market" | "currency">,
  startDate: string,
  endDate: string
): Promise<HistoricalMarketQuote[]> {
  if (!asset.ticker?.trim()) {
    throw new Error("티커가 없습니다.");
  }

  const symbol = asset.ticker.trim();
  const url = yahooChartUrl(symbol, startDate, endDate);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "youngs-plan/1.0"
    }
  }).catch(() => null);

  if (!response?.ok) {
    throw new Error(`과거 가격 조회 실패 (${response?.status ?? "network"})`);
  }

  const rows = parseYahooDailyCloses(await response.json(), symbol).map((quote) => ({
    ...quote,
    currency: asset.currency,
    source: "yahoo" as const
  }));

  if (rows.length === 0) {
    throw new Error("과거 가격 데이터를 찾지 못했습니다.");
  }

  return rows.filter((quote) => quote.date >= startDate && quote.date <= endDate);
}

export async function fetchUsdKrwHistory(startDate: string, endDate: string): Promise<HistoricalFxQuote[]> {
  const response = await fetch(yahooChartUrl("KRW=X", startDate, endDate), {
    headers: {
      Accept: "application/json",
      "User-Agent": "youngs-plan/1.0"
    }
  }).catch(() => null);

  if (!response?.ok) {
    throw new Error(`과거 환율 조회 실패 (${response?.status ?? "network"})`);
  }

  const rows = parseYahooDailyCloses(await response.json(), "KRW=X").map((quote) => ({
    rate: quote.price,
    date: quote.date,
    source: "yahoo" as const
  }));

  if (rows.length === 0) {
    throw new Error("과거 환율 데이터를 찾지 못했습니다.");
  }

  return rows.filter((quote) => quote.date >= startDate && quote.date <= endDate);
}

function yahooFxHistoryUrl(date: string) {
  const target = new Date(`${date}T00:00:00.000Z`);
  const start = new Date(target);
  const end = new Date(target);
  start.setUTCDate(target.getUTCDate() - 7);
  end.setUTCDate(target.getUTCDate() + 2);
  const period1 = Math.floor(start.getTime() / 1000);
  const period2 = Math.floor(end.getTime() / 1000);
  return `https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?period1=${period1}&period2=${period2}&interval=1d`;
}

function yahooChartUrl(symbol: string, startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const period1 = Math.floor(start.getTime() / 1000);
  const period2 = Math.floor(end.getTime() / 1000);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
}

async function fetchYahooQuote(ticker: string): Promise<MarketQuote | null> {
  const symbol = ticker.trim();
  if (!symbol) {
    return null;
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "youngs-plan/1.0"
    }
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const rows = parseYahooDailyCloses(await response.json(), symbol);
  return rows.at(-1) ?? null;
}

function parseYahooDailyCloses(body: unknown, symbol: string): MarketQuote[] {
  const parsed = body as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const result = parsed.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const timestamps = result?.timestamp ?? [];
  const rows: MarketQuote[] = [];

  for (let index = 0; index < closes.length; index += 1) {
    const close = closes[index];
    if (close !== null && close !== undefined && Number.isFinite(close) && close > 0) {
      rows.push({
        price: close,
        date: new Date((timestamps[index] ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10),
        symbol,
        source: "yahoo"
      });
    }
  }

  return rows;
}

function normalizeStooqSymbol(ticker: string, market: AssetWithAccount["market"]): string {
  const normalized = ticker.trim().toLowerCase();
  if (normalized.includes(".")) {
    return normalized;
  }

  if (market === "us") {
    return `${normalized}.us`;
  }

  return normalized;
}

function parseStooqQuote(csv: string, requestedSymbol: string): MarketQuote | null {
  const [headerLine, rowLine] = csv.trim().split(/\r?\n/);
  if (!headerLine || !rowLine) {
    return null;
  }

  const headers = headerLine.split(",");
  const values = rowLine.split(",");
  const row = headers.reduce<Record<string, string>>((acc, header, index) => {
    acc[header.trim().toLowerCase()] = values[index]?.trim() ?? "";
    return acc;
  }, {});

  const close = Number(row.close);
  if (!Number.isFinite(close) || close <= 0) {
    return null;
  }

  return {
    price: close,
    date: row.date || new Date().toISOString().slice(0, 10),
    symbol: row.symbol || requestedSymbol,
    source: "stooq"
  };
}

function inferMarket(symbol: string): AssetMarket {
  const lower = symbol.toLowerCase();
  if (lower.endsWith(".ks") || lower.endsWith(".kq")) {
    return "domestic";
  }

  if (/^[a-z.]+$/i.test(symbol) && !symbol.includes(".")) {
    return "us";
  }

  return "other";
}

function isEquityLike(quoteType?: string) {
  return !quoteType || ["EQUITY", "ETF", "MUTUALFUND"].includes(quoteType);
}

function searchKoreanTickers(query: string): TickerSearchResult[] {
  const normalized = query.replace(/\s+/g, "").toLowerCase();
  return koreanTickerSeeds
    .filter((item) =>
      [item.name, item.symbol, ...item.aliases].some((value) => value.replace(/\s+/g, "").toLowerCase().includes(normalized))
    )
    .map((item) => ({
      symbol: item.symbol,
      name: item.name,
      exchange: item.exchange,
      market: "domestic",
      currency: "KRW"
    }));
}

function mergeTickerResults(results: TickerSearchResult[]): TickerSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.symbol.toUpperCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const koreanTickerSeeds = [
  { symbol: "005930.KS", name: "삼성전자", exchange: "KOSPI", aliases: ["Samsung Electronics", "삼전"] },
  { symbol: "000660.KS", name: "SK하이닉스", exchange: "KOSPI", aliases: ["SK Hynix", "하이닉스"] },
  { symbol: "373220.KS", name: "LG에너지솔루션", exchange: "KOSPI", aliases: ["LG Energy Solution", "엘지에너지솔루션"] },
  { symbol: "207940.KS", name: "삼성바이오로직스", exchange: "KOSPI", aliases: ["Samsung Biologics"] },
  { symbol: "005380.KS", name: "현대차", exchange: "KOSPI", aliases: ["Hyundai Motor", "현대자동차"] },
  { symbol: "000270.KS", name: "기아", exchange: "KOSPI", aliases: ["Kia"] },
  { symbol: "068270.KS", name: "셀트리온", exchange: "KOSPI", aliases: ["Celltrion"] },
  { symbol: "035420.KS", name: "NAVER", exchange: "KOSPI", aliases: ["네이버"] },
  { symbol: "035720.KS", name: "카카오", exchange: "KOSPI", aliases: ["Kakao"] },
  { symbol: "005490.KS", name: "POSCO홀딩스", exchange: "KOSPI", aliases: ["포스코홀딩스", "POSCO"] },
  { symbol: "051910.KS", name: "LG화학", exchange: "KOSPI", aliases: ["LG Chem"] },
  { symbol: "006400.KS", name: "삼성SDI", exchange: "KOSPI", aliases: ["Samsung SDI"] },
  { symbol: "028260.KS", name: "삼성물산", exchange: "KOSPI", aliases: ["Samsung C&T"] },
  { symbol: "012330.KS", name: "현대모비스", exchange: "KOSPI", aliases: ["Hyundai Mobis"] },
  { symbol: "105560.KS", name: "KB금융", exchange: "KOSPI", aliases: ["KB Financial"] },
  { symbol: "055550.KS", name: "신한지주", exchange: "KOSPI", aliases: ["Shinhan"] },
  { symbol: "086790.KS", name: "하나금융지주", exchange: "KOSPI", aliases: ["Hana Financial"] },
  { symbol: "323410.KS", name: "카카오뱅크", exchange: "KOSPI", aliases: ["KakaoBank"] },
  { symbol: "352820.KS", name: "하이브", exchange: "KOSPI", aliases: ["HYBE"] },
  { symbol: "259960.KS", name: "크래프톤", exchange: "KOSPI", aliases: ["Krafton"] },
  { symbol: "066570.KS", name: "LG전자", exchange: "KOSPI", aliases: ["LG Electronics"] },
  { symbol: "003550.KS", name: "LG", exchange: "KOSPI", aliases: ["LG Corp"] },
  { symbol: "015760.KS", name: "한국전력", exchange: "KOSPI", aliases: ["KEPCO", "한전"] },
  { symbol: "096770.KS", name: "SK이노베이션", exchange: "KOSPI", aliases: ["SK Innovation"] },
  { symbol: "034730.KS", name: "SK", exchange: "KOSPI", aliases: ["SK Inc"] },
  { symbol: "247540.KQ", name: "에코프로비엠", exchange: "KOSDAQ", aliases: ["Ecopro BM"] },
  { symbol: "086520.KQ", name: "에코프로", exchange: "KOSDAQ", aliases: ["Ecopro"] },
  { symbol: "091990.KQ", name: "셀트리온헬스케어", exchange: "KOSDAQ", aliases: ["Celltrion Healthcare"] },
  { symbol: "293490.KQ", name: "카카오게임즈", exchange: "KOSDAQ", aliases: ["Kakao Games"] },
  { symbol: "440110.KQ", name: "파두", exchange: "KOSDAQ", aliases: ["FADU", "Fadu"] },
  { symbol: "196170.KQ", name: "알테오젠", exchange: "KOSDAQ", aliases: ["Alteogen"] },
  { symbol: "028300.KQ", name: "HLB", exchange: "KOSDAQ", aliases: ["에이치엘비"] },
  { symbol: "041510.KQ", name: "에스엠", exchange: "KOSDAQ", aliases: ["SM Entertainment", "SM"] },
  { symbol: "035900.KQ", name: "JYP Ent.", exchange: "KOSDAQ", aliases: ["JYP", "제이와이피"] },
  { symbol: "263750.KQ", name: "펄어비스", exchange: "KOSDAQ", aliases: ["Pearl Abyss"] }
];
