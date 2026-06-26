import type { BorrowerSignals, ScoreResult } from "./scoring";

export type RationaleSource = "gemini" | "template";

const SYSTEM_PROMPT =
  "You are Credo's AI credit underwriter, writing the rationale for an on-chain under-collateralized " +
  "lending decision on HashKey Chain. The score, tier, max LTV, interest rate and principal cap are " +
  "produced by a deterministic, audited scoring model — you must NOT change, recompute, or invent any " +
  "numbers; cite only the figures provided. In 3-5 sentences, explain why this borrower earned this " +
  "score and these terms, grounded in the specific signal breakdown (wallet age, activity, holdings, " +
  "DeFi history, prior liquidations, Credo repayment record). Write for institutional risk reviewers: " +
  "precise, neutral, no marketing tone, no markdown headings or bullet lists.";

/** OpenRouter endpoint (OpenAI-compatible). Default model is Google's Gemini 3 Flash. */
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

/**
 * Generates a human-readable underwriting rationale. Uses Gemini (via OpenRouter) when a key is
 * configured; otherwise falls back to a deterministic template so the route always responds.
 * The numbers never change — the model only narrates the deterministic decision.
 */
export async function generateRationale(
  signals: BorrowerSignals,
  score: ScoreResult,
): Promise<{ text: string; source: RationaleSource }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey) {
    try {
      const text = await viaOpenRouter(signals, score, apiKey);
      return { text, source: "gemini" };
    } catch {
      // fall through to template on any API failure
    }
  }
  return { text: templateRationale(signals, score), source: "template" };
}

async function viaOpenRouter(
  signals: BorrowerSignals,
  score: ScoreResult,
  apiKey: string,
): Promise<string> {
  const model = process.env.CREDO_LLM_MODEL ?? DEFAULT_MODEL;
  const payload = {
    decision: {
      score: score.score,
      tier: score.tier,
      approvedForUnderCollateralized: score.approved,
      maxLtvBps: score.maxLtvBps,
      collateralRatioPct: score.collateralRatioPct,
      interestRateBps: score.interestRateBps,
      maxPrincipalUsd: score.maxPrincipalUsd,
    },
    signalBreakdown: score.features.map((f) => ({
      feature: f.label,
      value: f.raw,
      normalized: Number(f.normalized.toFixed(3)),
      weight: f.weight,
      points: f.points,
    })),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter attribution headers (optional but recommended).
        "HTTP-Referer": "https://github.com/RaYYeR220/credo",
        "X-Title": "Credo",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `Borrower ${signals.address}. Write the underwriting rationale for this decision.\n\n` +
              JSON.stringify(payload, null, 2),
          },
        ],
      }),
    });

    if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("empty rationale");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function templateRationale(signals: BorrowerSignals, score: ScoreResult): string {
  const top = [...score.features].sort((a, b) => b.points - a.points).slice(0, 3);
  const drivers = top.map((f) => `${f.label.toLowerCase()} (${f.raw})`).join(", ");
  const verdict = score.approved
    ? `qualifies for under-collateralized credit at ${score.collateralRatioPct}% collateral`
    : `does not qualify for under-collateralized credit and is offered over-collateralized terms only (${score.collateralRatioPct}% collateral)`;
  return (
    `Borrower scored ${score.score}/1000 (tier ${score.tier}). The decision is driven primarily by ${drivers}. ` +
    `Credo on-chain history: ${signals.credo.hasHistory ? `${signals.credo.loansRepaid} repaid / ${signals.credo.loansDefaulted} defaulted` : "no prior Credo loans"}. ` +
    `At this score the borrower ${verdict}, with a maximum loan of $${score.maxPrincipalUsd.toLocaleString("en-US")} at ${(score.interestRateBps / 100).toFixed(1)}% APR.`
  );
}
