import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLatestQuote } from "../src/price.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("price quotes", () => {
  it("marks Yahoo quotes with the yahoo source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  timestamp: [1_780_000_000],
                  indicators: { quote: [{ close: [123.45] }] }
                }
              ]
            }
          }),
          { status: 200 }
        )
      )
    );

    await expect(fetchLatestQuote({ ticker: "AAPL", market: "us" })).resolves.toMatchObject({
      price: 123.45,
      source: "yahoo"
    });
  });

  it("falls back to Stooq and records the stooq source", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 503 }))
        .mockResolvedValueOnce(new Response("Symbol,Date,Close\naapl.us,2026-05-29,125.5\n", { status: 200 }))
    );

    await expect(fetchLatestQuote({ ticker: "AAPL", market: "us" })).resolves.toMatchObject({
      price: 125.5,
      date: "2026-05-29",
      symbol: "aapl.us",
      source: "stooq"
    });
  });

  it("fails when neither provider returns a usable quote", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("bad", { status: 200 }))
    );

    await expect(fetchLatestQuote({ ticker: "AAPL", market: "us" })).rejects.toThrow("가격 데이터를 찾지 못했습니다.");
  });
});
