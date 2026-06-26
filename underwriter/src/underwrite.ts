import { getAddress, type Address } from "viem";
import { loadConfig, loadDeployment, publicClientFor, type Config } from "./config.js";
import { creditManagerAbi } from "./abi.js";
import { gatherSignals } from "./signals.js";
import { scoreBorrower, type BorrowerSignals, type ScoreResult } from "./scoring.js";
import { generateRationale, type RationaleSource } from "./rationale.js";
import { buildAndSignTerms, type SignedAttestation } from "./attestation.js";

export interface UnderwriteResult {
  address: Address;
  chainId: number;
  signals: BorrowerSignals;
  score: ScoreResult;
  rationale: { text: string; source: RationaleSource };
  attestation?: SignedAttestation;
  warnings: string[];
}

/** Full underwriting pipeline: signals -> deterministic score -> rationale -> signed attestation. */
export async function underwrite(
  rawAddress: string,
  chainId?: number,
  cfg: Config = loadConfig(),
): Promise<UnderwriteResult> {
  const address = getAddress(rawAddress);
  const chain = chainId ?? cfg.chainId;
  const deployment = loadDeployment(chain);
  const warnings: string[] = [];

  const signals = await gatherSignals({
    address,
    chainId: chain,
    deployment,
    etherscanApiKey: cfg.etherscanApiKey,
  });
  if (!cfg.etherscanApiKey) {
    warnings.push("ETHERSCAN_API_KEY not set — wallet age and DeFi breadth signals are unavailable.");
  }

  const score = scoreBorrower(signals);
  const rationale = await generateRationale(signals, score, cfg);
  if (rationale.source === "template") {
    warnings.push("Rationale generated from template (no OPENROUTER_API_KEY or LLM call failed).");
  }

  let attestation: SignedAttestation | undefined;
  if (cfg.underwriterPrivateKey) {
    const nonce = (await publicClientFor(chain).readContract({
      address: deployment.creditManager,
      abi: creditManagerAbi,
      functionName: "nonces",
      args: [address],
    })) as bigint;

    attestation = await buildAndSignTerms({
      borrower: address,
      chainId: chain,
      creditManager: deployment.creditManager,
      score,
      nonce,
      termSeconds: cfg.termSeconds,
      ttlSeconds: cfg.attestationTtlSeconds,
      underwriterPrivateKey: cfg.underwriterPrivateKey,
    });
  } else {
    warnings.push("UNDERWRITER_PRIVATE_KEY not set — returning an unsigned quote (borrowing needs a signature).");
  }

  return { address, chainId: chain, signals, score, rationale, attestation, warnings };
}
