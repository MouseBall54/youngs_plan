import { describe, expect, it } from "vitest";
import {
  assetSaleRestrictionFormState,
  hasSaleRestrictionFormChanged,
  liquidFromForSaleRestrictionForm,
  liquidFromForSaleRestrictionLot
} from "./assetFormState";

describe("asset sale restriction form state", () => {
  it("checks sale restriction for a bond when liquidFrom is later than valuationDate", () => {
    expect(
      assetSaleRestrictionFormState([
        {
          valuationDate: "2026-05-26",
          liquidFrom: "2027-03-31"
        }
      ])
    ).toEqual({
      isSaleRestricted: true,
      liquidFrom: "2027-03-31"
    });
  });

  it("does not check sale restriction for a bond only because it has a future maturity date", () => {
    expect(
      assetSaleRestrictionFormState([
        {
          valuationDate: "2026-05-26",
          liquidFrom: "2026-05-26"
        }
      ])
    ).toEqual({
      isSaleRestricted: false,
      liquidFrom: "2026-05-26"
    });
  });

  it("does not check sale restriction for account-only liquidity restrictions", () => {
    expect(
      assetSaleRestrictionFormState([
        {
          valuationDate: "2026-05-26",
          liquidFrom: "2026-05-26"
        }
      ]).isSaleRestricted
    ).toBe(false);
  });

  it("uses the latest restricted liquidFrom when a grouped asset has multiple lots", () => {
    expect(
      assetSaleRestrictionFormState([
        {
          valuationDate: "2026-02-20",
          liquidFrom: "2026-08-31"
        },
        {
          valuationDate: "2026-06-02",
          liquidFrom: "2026-06-02"
        }
      ])
    ).toEqual({
      isSaleRestricted: true,
      liquidFrom: "2026-08-31"
    });
  });

  it("resets a single edited asset to its valuation date when sale restriction is unchecked", () => {
    expect(
      liquidFromForSaleRestrictionForm({
        valuationDate: "2026-05-26",
        liquidFrom: "2027-03-31",
        isSaleRestricted: false
      })
    ).toBe("2026-05-26");
  });

  it("applies the entered unlock date when sale restriction is checked", () => {
    expect(
      liquidFromForSaleRestrictionForm({
        valuationDate: "2026-05-26",
        liquidFrom: "2027-03-31",
        isSaleRestricted: true
      })
    ).toBe("2027-03-31");
  });

  it("resets each aggregate lot to its own valuation date when sale restriction is unchecked", () => {
    expect(
      liquidFromForSaleRestrictionLot(
        {
          valuationDate: "2026-02-20",
          liquidFrom: "2026-08-31"
        },
        {
          valuationDate: "2026-02-20",
          liquidFrom: "2026-08-31",
          isSaleRestricted: false
        }
      )
    ).toBe("2026-02-20");
  });

  it("detects when a grouped sale restriction has actually changed", () => {
    const lots = [
      {
        valuationDate: "2026-02-20",
        liquidFrom: "2026-08-31"
      }
    ];

    expect(
      hasSaleRestrictionFormChanged(lots, {
        valuationDate: "2026-02-20",
        liquidFrom: "2026-08-31",
        isSaleRestricted: true
      })
    ).toBe(false);
    expect(
      hasSaleRestrictionFormChanged(lots, {
        valuationDate: "2026-02-20",
        liquidFrom: "2026-02-20",
        isSaleRestricted: false
      })
    ).toBe(true);
  });
});
