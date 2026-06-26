/** Client for the Credo underwriter service + helpers to map its output to the statement UI. */

// By default the underwriter runs as a same-origin Next.js Route Handler (`/api/underwrite`), so the
// whole demo is one Vercel deploy. Set NEXT_PUBLIC_UNDERWRITER_URL to point at a standalone Express
// service instead (it exposes `/underwrite`).
const UNDERWRITER_URL = process.env.NEXT_PUBLIC_UNDERWRITER_URL;

export interface FeatureContribution {
  key: string;
  label: string;
  raw: number | string;
  normalized: number;
  weight: number;
  points: number;
  note: string;
}

export interface ScoreResult {
  score: number;
  tier: "A" | "B" | "C" | "D" | "E";
  approved: boolean;
  maxLtvBps: number;
  interestRateBps: number;
  maxPrincipalUsd: number;
  collateralRatioPct: number;
  features: FeatureContribution[];
  summary: string;
}

export interface SignedAttestation {
  terms: {
    borrower: `0x${string}`;
    maxPrincipal: string;
    maxLtvBps: number;
    interestRateBps: number;
    termSeconds: string;
    scoreId: string;
    nonce: string;
    expiry: string;
  };
  signature: `0x${string}`;
  underwriter: `0x${string}`;
}

export interface UnderwriteResult {
  address: `0x${string}`;
  chainId: number;
  score: ScoreResult;
  rationale: { text: string; source: "gemini" | "template" };
  attestation?: SignedAttestation;
  warnings: string[];
}

export async function requestUnderwriting(address: string, chainId: number): Promise<UnderwriteResult> {
  const endpoint = UNDERWRITER_URL ? `${UNDERWRITER_URL}/underwrite` : "/api/underwrite";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, chainId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Underwriter returned ${res.status}`);
  }
  return (await res.json()) as UnderwriteResult;
}

// --- presentation mapping ------------------------------------------------

export interface StatementSignal {
  n: string;
  name: string;
  sub: string;
  reading: string;
  weight: string;
  points: number;
  drag: boolean;
}

export interface StatementData {
  borrower: string;
  borrowerLabel: string;
  reportNo: string;
  issued: string;
  score: number;
  max: number;
  tier: string;
  determination: string;
  offer: { amount: string; collateral: string; ltv: string; rate: string; term: string };
  rationale: string;
  signals: StatementSignal[];
}

export function maxPoints(signals: { points: number }[]): number {
  return signals.reduce((m, s) => Math.max(m, s.points), 1);
}

const usd = (n: number) => n.toLocaleString("en-US");

/** Builds the statement view-model from a live underwriting result. */
export function toStatementData(r: UnderwriteResult): StatementData {
  const s = r.score;
  const termDays = r.attestation ? Math.round(Number(r.attestation.terms.termSeconds) / 86_400) : 30;
  const short = `${r.address.slice(0, 6)}…${r.address.slice(-4)}`;
  return {
    borrower: short,
    borrowerLabel: "connected wallet",
    reportNo: `CRD-${String(s.score).padStart(4, "0")}`,
    issued: "live assessment",
    score: s.score,
    max: 1000,
    tier: s.tier,
    determination: s.approved ? "Approved · under-collateralized" : "Over-collateralized terms only",
    offer: {
      amount: usd(s.maxPrincipalUsd),
      collateral: `${s.collateralRatioPct}%`,
      ltv: `${s.maxLtvBps / 100}%`,
      rate: `${(s.interestRateBps / 100).toFixed(1)}% APR`,
      term: `${termDays} days`,
    },
    rationale: r.rationale.text,
    signals: s.features.map((f, i) => ({
      n: String(i + 1).padStart(2, "0"),
      name: f.label,
      sub: shortNote(f.key),
      reading: String(f.raw),
      weight: `${Math.round(f.weight * 100)}%`,
      points: f.points,
      drag: f.normalized < 0.5,
    })),
  };
}

function shortNote(key: string): string {
  switch (key) {
    case "walletAge": return "Account longevity";
    case "activity": return "Ledger throughput";
    case "balance": return "Skin in the game";
    case "defi": return "Protocol breadth";
    case "liquidations": return "Default record";
    case "credoRepayment": return "Prior obligations";
    default: return "On-chain signal";
  }
}

/**
 * Collateral (mETH, 18 dec) required to borrow `principalUsd` at the attested max LTV, with a small
 * safety buffer so realized LTV lands under the cap. ethPriceUsd has 8 decimals (oracle convention).
 */
export function collateralForPrincipal(principalUsd: number, maxLtvBps: number, ethPriceUsd8: bigint): bigint {
  const ethPrice = Number(ethPriceUsd8) / 1e8;
  const ltv = maxLtvBps / 10_000;
  const collateralUsd = (principalUsd / ltv) * 1.03; // 3% buffer
  const meth = collateralUsd / ethPrice;
  // round up to 4 decimals -> wei
  const wei = BigInt(Math.ceil(meth * 1e4)) * BigInt(1e14);
  return wei;
}
