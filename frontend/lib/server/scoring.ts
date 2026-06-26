/**
 * Credo deterministic credit-scoring engine (server copy).
 *
 * This is the load-bearing risk math — fully transparent and auditable, NOT an LLM guess.
 * Each on-chain signal is normalized to [0,1] via a documented transform, multiplied by a fixed
 * weight, and summed into a 0..1000 score. The score maps to a risk tier, which sets the
 * under-collateralized loan terms (max LTV, interest rate, principal cap). The LLM only narrates
 * the result afterwards; it never moves the number.
 *
 * Mirror of underwriter/src/scoring.ts — kept in sync so the Vercel route and the standalone
 * service produce identical decisions.
 */

export type Tier = "A" | "B" | "C" | "D" | "E";

/** Raw signals gathered for a borrower address (cross-chain history + Credo's own reputation). */
export interface BorrowerSignals {
  address: string;
  /** Days since the address's first outbound transaction (any supported chain). */
  walletAgeDays: number;
  /** Total transaction count across supported chains. */
  txCount: number;
  /** Estimated USD value of holdings (native + major tokens). */
  balanceUsd: number;
  /** Count of distinct DeFi protocols the address has interacted with. */
  defiProtocolsUsed: number;
  /** Count of prior liquidation events against the address on major lending protocols. */
  priorLiquidations: number;
  /** Credo's on-chain repayment history (the reputation flywheel). */
  credo: {
    loansRepaid: number;
    loansDefaulted: number;
    hasHistory: boolean;
  };
}

export interface FeatureContribution {
  key: string;
  label: string;
  raw: number | string;
  normalized: number; // 0..1
  weight: number; // 0..1
  points: number; // normalized * weight * 1000 (rounded)
  note: string;
}

export interface ScoreResult {
  score: number; // 0..1000
  tier: Tier;
  approved: boolean; // false => protocol will only offer over-collateralized fallback terms
  maxLtvBps: number; // loan value / collateral value ceiling, bps (>10000 = under-collateralized)
  interestRateBps: number; // APR, bps
  maxPrincipalUsd: number;
  collateralRatioPct: number; // collateral / loan, % (for display; <100 = under-collateralized)
  features: FeatureContribution[];
  summary: string; // one-line deterministic summary (LLM elaborates separately)
}

/** Fixed feature weights — they sum to 1.0. Documented and stable across borrowers. */
export const WEIGHTS = {
  walletAge: 0.18,
  activity: 0.14,
  balance: 0.2,
  defi: 0.1,
  liquidations: 0.18,
  credoRepayment: 0.2,
} as const;

/** Protocol-side ceiling on a single loan, in USD (mirrors CreditManager.perLoanCap). */
export const PER_LOAN_CAP_USD = 50_000;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// --- documented normalization transforms (each -> [0,1], higher = lower risk) ---

/** Wallet age saturates at ~3 years. */
const normWalletAge = (days: number): number => clamp01(days / 1095);

/** Activity on a log scale, saturating around 500 transactions. */
const normActivity = (txCount: number): number =>
  txCount <= 0 ? 0 : clamp01(Math.log10(1 + txCount) / Math.log10(501));

/** Holdings (skin in the game) on a log scale, saturating around $100k. */
const normBalance = (usd: number): number =>
  usd <= 0 ? 0 : clamp01(Math.log10(1 + usd) / Math.log10(100_001));

/** DeFi sophistication saturates at 10 distinct protocols. */
const normDefi = (count: number): number => clamp01(count / 10);

/** Each prior liquidation removes ~0.34; three wipes the signal out. */
const normLiquidations = (count: number): number => clamp01(1 - count * 0.34);

/** Credo repayment rate over closed loans; neutral 0.5 when there is no history yet. */
const normCredo = (c: BorrowerSignals["credo"]): number => {
  const closed = c.loansRepaid + c.loansDefaulted;
  if (!c.hasHistory || closed === 0) return 0.5;
  return clamp01(c.loansRepaid / closed);
};

interface TierTerms {
  tier: Tier;
  maxLtvBps: number;
  interestRateBps: number;
}

/** Score band -> loan terms. A/B/C unlock under-collateralized credit; D/E only over-collateralized. */
function tierTermsForScore(score: number): TierTerms {
  if (score >= 800) return { tier: "A", maxLtvBps: 25_000, interestRateBps: 800 }; // 40% collateral, 8% APR
  if (score >= 650) return { tier: "B", maxLtvBps: 18_000, interestRateBps: 1200 }; // 56% collateral, 12% APR
  if (score >= 500) return { tier: "C", maxLtvBps: 12_000, interestRateBps: 1800 }; // 83% collateral, 18% APR
  if (score >= 350) return { tier: "D", maxLtvBps: 8_000, interestRateBps: 2500 }; // 125% collateral, 25% APR
  return { tier: "E", maxLtvBps: 6_600, interestRateBps: 3000 }; // 152% collateral, 30% APR
}

export function scoreBorrower(signals: BorrowerSignals): ScoreResult {
  const specs: Array<Omit<FeatureContribution, "points">> = [
    {
      key: "walletAge",
      label: "Wallet age",
      raw: `${signals.walletAgeDays}d`,
      normalized: normWalletAge(signals.walletAgeDays),
      weight: WEIGHTS.walletAge,
      note: "Older addresses have demonstrated longevity and are harder to fabricate.",
    },
    {
      key: "activity",
      label: "Transaction activity",
      raw: signals.txCount,
      normalized: normActivity(signals.txCount),
      weight: WEIGHTS.activity,
      note: "Sustained on-chain activity signals a real, engaged user.",
    },
    {
      key: "balance",
      label: "Holdings (skin in the game)",
      raw: `$${Math.round(signals.balanceUsd).toLocaleString("en-US")}`,
      normalized: normBalance(signals.balanceUsd),
      weight: WEIGHTS.balance,
      note: "Assets at stake align incentives against default.",
    },
    {
      key: "defi",
      label: "DeFi sophistication",
      raw: signals.defiProtocolsUsed,
      normalized: normDefi(signals.defiProtocolsUsed),
      weight: WEIGHTS.defi,
      note: "Experience across protocols correlates with responsible usage.",
    },
    {
      key: "liquidations",
      label: "Prior liquidations",
      raw: signals.priorLiquidations,
      normalized: normLiquidations(signals.priorLiquidations),
      weight: WEIGHTS.liquidations,
      note: "Past liquidations are the strongest negative predictor of repayment.",
    },
    {
      key: "credoRepayment",
      label: "Credo repayment history",
      raw: signals.credo.hasHistory
        ? `${signals.credo.loansRepaid}/${signals.credo.loansRepaid + signals.credo.loansDefaulted} repaid`
        : "no history",
      normalized: normCredo(signals.credo),
      weight: WEIGHTS.credoRepayment,
      note: "Credo's own on-chain repayment record — the reputation flywheel.",
    },
  ];

  const weightedNorm = specs.reduce((acc, f) => acc + f.normalized * f.weight, 0);
  const score = Math.round(clamp01(weightedNorm) * 1000);

  const features: FeatureContribution[] = specs.map((f) => ({
    ...f,
    points: Math.round(f.normalized * f.weight * 1000),
  }));

  const { tier, maxLtvBps, interestRateBps } = tierTermsForScore(score);
  const approved = maxLtvBps > 10_000; // under-collateralized credit is offered
  const collateralRatioPct = Math.round((10_000 / maxLtvBps) * 100);
  const maxPrincipalUsd = Math.round(
    Math.min(PER_LOAN_CAP_USD, 1000 + (score / 1000) * (PER_LOAN_CAP_USD - 1000)),
  );

  const summary = approved
    ? `Tier ${tier} (score ${score}/1000): under-collateralized up to ${maxLtvBps / 100}% LTV ` +
      `(${collateralRatioPct}% collateral) at ${(interestRateBps / 100).toFixed(1)}% APR, ` +
      `max $${maxPrincipalUsd.toLocaleString("en-US")}.`
    : `Tier ${tier} (score ${score}/1000): under-collateralized credit declined; ` +
      `over-collateralized fallback only (${collateralRatioPct}% collateral) at ${(interestRateBps / 100).toFixed(1)}% APR.`;

  return {
    score,
    tier,
    approved,
    maxLtvBps,
    interestRateBps,
    maxPrincipalUsd,
    collateralRatioPct,
    features,
    summary,
  };
}
