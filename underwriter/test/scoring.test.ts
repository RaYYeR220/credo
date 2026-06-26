import { describe, it, expect } from "vitest";
import {
  scoreBorrower,
  PER_LOAN_CAP_USD,
  type BorrowerSignals,
} from "../src/scoring.js";

const strong: BorrowerSignals = {
  address: "0xStrong",
  walletAgeDays: 1500,
  txCount: 800,
  balanceUsd: 120_000,
  defiProtocolsUsed: 12,
  priorLiquidations: 0,
  credo: { loansRepaid: 5, loansDefaulted: 0, hasHistory: true },
};

const weak: BorrowerSignals = {
  address: "0xWeak",
  walletAgeDays: 5,
  txCount: 3,
  balanceUsd: 20,
  defiProtocolsUsed: 0,
  priorLiquidations: 2,
  credo: { loansRepaid: 0, loansDefaulted: 2, hasHistory: true },
};

const mid: BorrowerSignals = {
  address: "0xMid",
  walletAgeDays: 300,
  txCount: 60,
  balanceUsd: 3_000,
  defiProtocolsUsed: 3,
  priorLiquidations: 0,
  credo: { loansRepaid: 0, loansDefaulted: 0, hasHistory: false },
};

describe("scoreBorrower", () => {
  it("scores a strong borrower into tier A with under-collateralized terms", () => {
    const r = scoreBorrower(strong);
    expect(r.tier).toBe("A");
    expect(r.approved).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(800);
    expect(r.collateralRatioPct).toBeLessThan(100); // under-collateralized
    expect(r.maxLtvBps).toBeGreaterThan(10_000);
  });

  it("rejects a weak borrower (tier E) and only offers over-collateralized fallback", () => {
    const r = scoreBorrower(weak);
    expect(r.tier).toBe("E");
    expect(r.approved).toBe(false);
    expect(r.collateralRatioPct).toBeGreaterThanOrEqual(150); // over-collateralized only
    expect(r.maxLtvBps).toBeLessThanOrEqual(10_000);
  });

  it("scores a mid borrower with no Credo history into a middle tier, approved", () => {
    const r = scoreBorrower(mid);
    expect(r.approved).toBe(true);
    expect(["B", "C", "D"]).toContain(r.tier);
    expect(r.score).toBeGreaterThan(300);
    expect(r.score).toBeLessThan(800);
  });

  it("always respects protocol ceilings", () => {
    for (const s of [strong, weak, mid]) {
      const r = scoreBorrower(s);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1000);
      expect(r.maxLtvBps).toBeLessThanOrEqual(30_000);
      expect(r.interestRateBps).toBeLessThanOrEqual(10_000);
      expect(r.maxPrincipalUsd).toBeLessThanOrEqual(PER_LOAN_CAP_USD);
    }
  });

  it("exposes exactly the 6 weighted features whose points reconstruct the score", () => {
    const r = scoreBorrower(strong);
    expect(r.features).toHaveLength(6);
    const sum = r.features.reduce((a, f) => a + f.points, 0);
    expect(Math.abs(sum - r.score)).toBeLessThanOrEqual(6); // rounding slack
    const weightSum = r.features.reduce((a, f) => a + f.weight, 0);
    expect(Math.abs(weightSum - 1)).toBeLessThan(1e-9);
  });

  it("is monotonic in balance (more skin in the game never lowers the score)", () => {
    const lo = scoreBorrower({ ...mid, balanceUsd: 100 });
    const hi = scoreBorrower({ ...mid, balanceUsd: 80_000 });
    expect(hi.score).toBeGreaterThanOrEqual(lo.score);
  });

  it("penalizes prior liquidations", () => {
    const clean = scoreBorrower({ ...mid, priorLiquidations: 0 });
    const liquidated = scoreBorrower({ ...mid, priorLiquidations: 3 });
    expect(liquidated.score).toBeLessThan(clean.score);
  });
});
