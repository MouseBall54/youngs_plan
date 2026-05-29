import "./env.js";
import cors from "cors";
import express from "express";
import { z } from "zod";
import {
  createAccount,
  createAsset,
  createTransaction,
  deleteAccount,
  deleteAsset,
  deleteTransaction,
  listAccounts,
  listAssets,
  listPositions,
  listStoredHistory,
  listTickerAssets,
  listTransactions,
  markAssetPriceError,
  processMaturedBonds,
  transactionTotalsByDate,
  transactionTotalsUntil,
  updateAccount,
  updateAsset,
  updateAssetPrice,
  updateTransaction
} from "./db.js";
import { fetchLatestQuote, fetchUsdKrwRate, searchTickers } from "./price.js";
import { buildProjectionHistory, mergeHistoryPoints, summarizeByDate, valueAssetsForDate } from "./valuation.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const accountSchema = z.object({
  name: z.string().min(1),
  institution: z.string().optional().nullable()
});

const assetSchema = z.object({
  accountId: z.string().min(1),
  type: z.enum(["stock", "real_estate", "cash", "bond", "dividend"]),
  name: z.string().min(1),
  market: z.enum(["domestic", "us", "other"]).default("domestic"),
  ticker: z.string().optional().nullable(),
  currency: z.string().min(3).max(3).default("KRW"),
  quantity: z.coerce.number().nonnegative().optional().nullable(),
  averageCost: z.coerce.number().nonnegative().optional().nullable(),
  currentValue: z.coerce.number().nonnegative().optional().nullable(),
  valuationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  purchaseFxRateToKrw: z.coerce.number().positive().default(1),
  fxRateToKrw: z.coerce.number().positive().default(1),
  liquidFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maturityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  maturityAmount: z.coerce.number().nonnegative().optional().nullable(),
  maturityCurrency: z.string().min(3).max(3).optional().nullable(),
  maturityFxRateToKrw: z.coerce.number().positive().optional().nullable(),
  autoConvertOnMaturity: z.coerce.boolean().optional().nullable(),
  notes: z.string().optional().nullable()
});

const transactionSchema = z.discriminatedUnion("transactionType", [
  z.object({
    transactionType: z.literal("buy"),
    accountId: z.string().min(1),
    type: z.enum(["stock", "real_estate", "cash", "bond", "dividend"]),
    name: z.string().min(1),
    market: z.enum(["domestic", "us", "other"]).default("domestic"),
    ticker: z.string().optional().nullable(),
    currency: z.string().min(3).max(3).default("KRW"),
    quantity: z.coerce.number().nonnegative().optional().nullable(),
    price: z.coerce.number().nonnegative().optional().nullable(),
    amount: z.coerce.number().nonnegative().optional().nullable(),
    currentValue: z.coerce.number().nonnegative().optional().nullable(),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    purchaseFxRateToKrw: z.coerce.number().positive().default(1),
    fxRateToKrw: z.coerce.number().positive().default(1),
    liquidFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    maturityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    maturityAmount: z.coerce.number().nonnegative().optional().nullable(),
    maturityCurrency: z.string().min(3).max(3).optional().nullable(),
    maturityFxRateToKrw: z.coerce.number().positive().optional().nullable(),
    autoConvertOnMaturity: z.coerce.boolean().optional().nullable(),
    notes: z.string().optional().nullable()
  }),
  z.object({
    transactionType: z.literal("sell"),
    assetId: z.string().min(1).optional().nullable(),
    positionKey: z.string().min(1).optional().nullable(),
    quantity: z.coerce.number().positive(),
    price: z.coerce.number().positive(),
    currency: z.string().min(3).max(3).default("KRW"),
    fxRateToKrw: z.coerce.number().positive().default(1),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().optional().nullable()
  }),
  z.object({
    transactionType: z.literal("dividend"),
    assetId: z.string().min(1).optional().nullable(),
    positionKey: z.string().min(1).optional().nullable(),
    amount: z.coerce.number().positive(),
    currency: z.string().min(3).max(3).default("KRW"),
    fxRateToKrw: z.coerce.number().positive().default(1),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().optional().nullable()
  })
]);

const historyRangeSchema = z.enum(["1w", "1m", "3m", "6m", "1y", "all"]).default("1m");

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/accounts", async (_req, res, next) => {
  try {
    res.json(await listAccounts());
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts", async (req, res, next) => {
  try {
    const input = accountSchema.parse(req.body);
    res.status(201).json(await createAccount(input));
  } catch (error) {
    next(error);
  }
});

app.put("/api/accounts/:id", async (req, res, next) => {
  try {
    const input = accountSchema.parse(req.body);
    const account = await updateAccount(req.params.id, input);
    if (!account) {
      res.status(404).json({ message: "Account not found" });
      return;
    }
    res.json(account);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:id", async (req, res, next) => {
  try {
    const deleted = await deleteAccount(req.params.id);
    if (!deleted) {
      res.status(404).json({ message: "Account not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/assets", async (req, res, next) => {
  try {
    const targetDate = String(req.query.date ?? today());
    await processMaturedBonds(maturityProcessDate(targetDate));
    const assets = await listAssets();
    res.json(valueAssetsForDate(assets, targetDate));
  } catch (error) {
    next(error);
  }
});

app.get("/api/positions", async (req, res, next) => {
  try {
    const targetDate = String(req.query.date ?? today());
    await processMaturedBonds(maturityProcessDate(targetDate));
    res.json(await listPositions(targetDate));
  } catch (error) {
    next(error);
  }
});

app.post("/api/assets", async (req, res, next) => {
  try {
    const input = assetSchema.parse(req.body);
    res.status(201).json(await createAsset(input));
  } catch (error) {
    next(error);
  }
});

app.put("/api/assets/:id", async (req, res, next) => {
  try {
    const input = assetSchema.parse(req.body);
    const asset = await updateAsset({ id: req.params.id, ...input });
    if (!asset) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }
    res.json(asset);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/assets/:id", async (req, res, next) => {
  try {
    const deleted = await deleteAsset(req.params.id);
    if (!deleted) {
      res.status(404).json({ message: "Asset not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/transactions", async (_req, res, next) => {
  try {
    await processMaturedBonds(today());
    res.json(await listTransactions());
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions", async (req, res, next) => {
  try {
    const input = transactionSchema.parse(req.body);
    res.status(201).json(await createTransaction(input));
  } catch (error) {
    next(error);
  }
});

app.put("/api/transactions/:id", async (req, res, next) => {
  try {
    const input = transactionSchema.parse(req.body);
    const transaction = await updateTransaction(req.params.id, input);
    if (!transaction) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }
    res.json(transaction);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/transactions/:id", async (req, res, next) => {
  try {
    const deleted = await deleteTransaction(req.params.id);
    if (!deleted) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/summary", async (req, res, next) => {
  try {
    const targetDate = String(req.query.date ?? today());
    await processMaturedBonds(maturityProcessDate(targetDate));
    const assets = await listAssets();
    const income = await transactionTotalsUntil(targetDate);
    res.json(summarizeByDate(assets, targetDate, income));
  } catch (error) {
    next(error);
  }
});

app.get("/api/history", async (req, res, next) => {
  try {
    const targetDate = String(req.query.date ?? today());
    const range = historyRangeSchema.parse(req.query.range ?? "1m");
    await processMaturedBonds(maturityProcessDate(targetDate));
    const assets = await listAssets();
    const rangeWindow = historyWindow(assets, targetDate, range);
    const startDate = rangeWindow.startDate;
    const dailyIncome = await transactionTotalsByDate(startDate, rangeWindow.endDate);
    const initialIncome = await transactionTotalsUntil(shiftDate(startDate, -1));
    const incomesByDate = Object.fromEntries(
      dailyIncome.map((item) => [item.date, { realizedGainKrw: item.realizedGainKrw, dividendIncomeKrw: item.dividendIncomeKrw }])
    );
    const projection = buildProjectionHistory(assets, rangeWindow.endDate, rangeWindow.days, incomesByDate, initialIncome);
    const stored = await listStoredHistory(projection[0]?.date ?? rangeWindow.startDate, rangeWindow.endDate);

    res.json({
      range,
      startDate: projection[0]?.date ?? rangeWindow.startDate,
      endDate: rangeWindow.endDate,
      points: mergeHistoryPoints(projection, stored)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/prices/refresh", async (_req, res, next) => {
  try {
    const assets = await listTickerAssets();
    const results = [];

    for (const asset of assets) {
      try {
        const quote = await fetchLatestQuote(asset);
        const fxRate =
          asset.currency === "USD" || asset.market === "us"
            ? await fetchUsdKrwRate()
            : { rate: asset.fxRateToKrw, date: quote.date };
        const purchaseFxRate =
          asset.currency === "USD" || asset.market === "us"
            ? await resolvePurchaseFxRate(asset.purchaseFxRateToKrw, asset.valuationDate)
            : asset.purchaseFxRateToKrw;
        await updateAssetPrice({
          id: asset.id,
          currentValue: quote.price,
          purchaseFxRateToKrw: purchaseFxRate,
          fxRateToKrw: fxRate.rate,
          source: quote.source
        });
        results.push({
          assetId: asset.id,
          name: asset.name,
          ticker: asset.ticker,
          ok: true,
          price: quote.price,
          date: quote.date,
          source: quote.source,
          fxRateToKrw: fxRate.rate
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "가격 업데이트 실패";
        await markAssetPriceError(asset.id, message);
        results.push({
          assetId: asset.id,
          name: asset.name,
          ticker: asset.ticker,
          ok: false,
          message
        });
      }
    }

    res.json({ updatedAt: new Date().toISOString(), results });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tickers/search", async (req, res, next) => {
  try {
    const query = z.string().min(2).parse(req.query.q);
    const market = z.enum(["domestic", "us", "other"]).parse(req.query.market ?? "us");
    res.json({ results: await searchTickers(query, market) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/fx/usd-krw", async (req, res, next) => {
  try {
    const date = req.query.date === undefined ? undefined : z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date);
    res.json(await fetchUsdKrwRate(date));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ message: "Invalid request", issues: error.issues });
    return;
  }

  if (error instanceof Error) {
    res.status(400).json({ message: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ message: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function maturityProcessDate(_targetDate: string) {
  return today();
}

function rangeToDays(range: z.infer<typeof historyRangeSchema>): number {
  switch (range) {
    case "1w":
      return 7;
    case "3m":
      return 90;
    case "6m":
      return 180;
    case "1y":
      return 365;
    case "all":
      return 730;
    case "1m":
    default:
      return 30;
  }
}

function historyWindow(
  assets: Awaited<ReturnType<typeof listAssets>>,
  targetDate: string,
  range: z.infer<typeof historyRangeSchema>
) {
  if (range !== "all") {
    const days = rangeToDays(range);
    return {
      startDate: shiftDate(targetDate, -(days - 1)),
      endDate: targetDate,
      days
    };
  }

  const startDate = minDate([targetDate, ...assets.map((asset) => asset.valuationDate)]);
  const endDate = maxDate([targetDate, ...assets.map((asset) => asset.liquidFrom)]);
  const days = Math.min(1826, daysInclusive(startDate, endDate));

  return {
    startDate: shiftDate(endDate, -(days - 1)),
    endDate,
    days
  };
}

function minDate(dates: string[]) {
  return dates.reduce((min, date) => (date < min ? date : min));
}

function maxDate(dates: string[]) {
  return dates.reduce((max, date) => (date > max ? date : max));
}

function daysInclusive(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function shiftDate(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function resolvePurchaseFxRate(currentRate: number, purchaseDate: string) {
  if (currentRate && currentRate !== 1) {
    return currentRate;
  }

  const quote = await fetchUsdKrwRate(purchaseDate);
  return quote.rate;
}
