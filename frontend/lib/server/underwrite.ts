import { getAddress, type Address } from "viem";
import { getDeployment } from "@/lib/deployments";
import { creditManagerAbi } from "@/lib/abis";
import { publicClientFor } from "./rpc";
import { gatherSignals } from "./signals";
import { scoreBorrower, type ScoreResult } from "./scoring";
import { generateRationale, type RationaleSource } from "./rationale-gemini";
import { buildAndSignTerms, type SignedAttestation } from "./attestation";

export interface UnderwriteResult {
  address: Address;
  chainId: number;
  score: ScoreResult;
  rationale: { text: string; source: RationaleSource };
  attestation?: SignedAttestation;
  warnings: string[];
}

const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 177);

/** Full underwriting pipeline: signals -> deterministic score -> Gemini rationale -> signed attestation. */
export async function underwrite(rawAddress: string, chainId?: number): Promise<UnderwriteResult> {
  const address = getAddress(rawAddress);
  const chain = chainId ?? DEFAULT_CHAIN_ID;
  const deployment = getDeployment(chain);
  if (!deployment) throw new Error(`No Credo deployment for chain ${chain}.`);

  const warnings: string[] = [];
  const etherscanApiKey = process.env.ETHERSCAN_API_KEY;

  const signals = await gatherSignals({ address, chainId: chain, deployment, etherscanApiKey });
  if (!etherscanApiKey) {
    warnings.push("ETHERSCAN_API_KEY not set — wallet age and DeFi breadth signals are unavailable.");
  }

  const score = scoreBorrower(signals);
  const rationale = await generateRationale(signals, score);
  if (rationale.source === "template") {
    warnings.push("Rationale generated from template (no OPENROUTER_API_KEY or LLM call failed).");
  }

  let attestation: SignedAttestation | undefined;
  const underwriterPrivateKey = process.env.UNDERWRITER_PRIVATE_KEY as `0x${string}` | undefined;
  if (underwriterPrivateKey) {
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
      termSeconds: Number(process.env.LOAN_TERM_SECONDS ?? 30 * 24 * 60 * 60),
      ttlSeconds: Number(process.env.ATTESTATION_TTL_SECONDS ?? 3600),
      underwriterPrivateKey,
    });
  } else {
    warnings.push(
      "UNDERWRITER_PRIVATE_KEY not set — returning an unsigned quote (borrowing needs a signature).",
    );
  }

  return { address, chainId: chain, score, rationale, attestation, warnings };
}
