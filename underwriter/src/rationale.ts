import Anthropic from "@anthropic-ai/sdk";
import type { BorrowerSignals, ScoreResult } from "./scoring.js";
import type { Config } from "./config.js";

const SYSTEM_PROMPT =
  "You are Credo's AI credit underwriter, writing the rationale for an on-chain under-collateralized " +
  "lending decision on HashKey Chain. The score, tier, max LTV, interest rate and principal cap are " +
  "produced by a deterministic, audited scoring model — you must NOT change, recompute, or invent any " +
  "numbers; cite only the figures provided. In 3-5 sentences, explain why this borrower earned this " +
  "score and these terms, grounded in the specific signal breakdown (wallet age, activity, holdings, " +
  "DeFi history, prior liquidations, Credo repayment record). Write for institutional risk reviewers: " +
  "precise, neutral, no marketing tone, no markdown headings or bullet lists.";

/** Generates a human-readable underwriting rationale. Uses Claude when a key is configured; otherwise
 *  falls back to a deterministic template so the service runs offline. The numbers never change. */
export async function generateRationale(
  signals: BorrowerSignals,
  score: ScoreResult,
  cfg: Config,
): Promise<{ text: string; source: "claude" | "template" }> {
  if (cfg.anthropicApiKey) {
    try {
      const text = await viaClaude(signals, score, cfg);
      return { text, source: "claude" };
    } catch {
      // fall through to template on any API failure
    }
  }
  return { text: templateRationale(signals, score), source: "template" };
}

async function viaClaude(signals: BorrowerSignals, score: ScoreResult, cfg: Config): Promise<string> {
  const client = new Anthropic({ apiKey: cfg.anthropicApiKey });
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

  const message = await client.messages.create({
    model: cfg.llmModel,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `Borrower ${signals.address}. Write the underwriting rationale for this decision.\n\n` +
          JSON.stringify(payload, null, 2),
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("empty rationale");
  return text;
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
