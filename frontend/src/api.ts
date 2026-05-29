import type {
  Account,
  AssetMarket,
  AssetPosition,
  AssetTransaction,
  FxRateResponse,
  HistoryResponse,
  PriceRefreshResponse,
  Summary,
  TickerSearchResponse
} from "./types";

const configuredApiBase = import.meta.env.VITE_API_BASE;
const apiBase =
  configuredApiBase && configuredApiBase !== "auto"
    ? configuredApiBase
    : `${window.location.protocol}//${window.location.hostname}:4000`;

export async function fetchAccounts(): Promise<Account[]> {
  return request("/api/accounts");
}

export async function createAccount(input: { name: string; institution?: string }): Promise<Account> {
  return request("/api/accounts", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateAccount(id: string, input: { name: string; institution?: string }): Promise<Account> {
  return request(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function deleteAccount(id: string): Promise<void> {
  await request(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function fetchSummary(date: string): Promise<Summary> {
  return request(`/api/summary?date=${encodeURIComponent(date)}`);
}

export async function fetchPositions(date: string): Promise<AssetPosition[]> {
  return request(`/api/positions?date=${encodeURIComponent(date)}`);
}

export async function fetchHistory(date: string, range: string): Promise<HistoryResponse> {
  return request(`/api/history?date=${encodeURIComponent(date)}&range=${encodeURIComponent(range)}`);
}

export async function createAsset(input: Record<string, unknown>) {
  return request("/api/assets", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateAsset(id: string, input: Record<string, unknown>) {
  return request(`/api/assets/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function deleteAsset(id: string): Promise<void> {
  await request(`/api/assets/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function fetchTransactions(): Promise<AssetTransaction[]> {
  return request("/api/transactions");
}

export async function createTransaction(input: Record<string, unknown>): Promise<AssetTransaction> {
  return request("/api/transactions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateTransaction(id: string, input: Record<string, unknown>): Promise<AssetTransaction> {
  return request(`/api/transactions/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function deleteTransaction(id: string): Promise<void> {
  await request(`/api/transactions/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function refreshPrices(): Promise<PriceRefreshResponse> {
  return request("/api/prices/refresh", {
    method: "POST"
  });
}

export async function searchTickers(query: string, market: AssetMarket): Promise<TickerSearchResponse> {
  return request(`/api/tickers/search?q=${encodeURIComponent(query)}&market=${encodeURIComponent(market)}`);
}

export async function fetchUsdKrwRate(date?: string): Promise<FxRateResponse> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return request(`/api/fx/usd-krw${query}`);
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? "Request failed");
  }

  if (response.status === 204) {
    return undefined;
  }

  return response.json();
}
