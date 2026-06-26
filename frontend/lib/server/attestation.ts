import { parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ScoreResult } from "./scoring";

/** EIP-712 type for the underwriter attestation — must match CreditManager.LOAN_TERMS_TYPEHASH. */
const loanTermsEip712Type = {
  LoanTerms: [
    { name: "borrower", type: "address" },
    { name: "maxPrincipal", type: "uint256" },
    { name: "maxLtvBps", type: "uint16" },
    { name: "interestRateBps", type: "uint16" },
    { name: "termSeconds", type: "uint64" },
    { name: "scoreId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

/** JSON-safe attestation returned to clients (bigints rendered as strings). */
export interface SignedAttestation {
  terms: {
    borrower: Address;
    maxPrincipal: string; // loan-asset units (mUSD, 18 decimals)
    maxLtvBps: number;
    interestRateBps: number;
    termSeconds: string;
    scoreId: string;
    nonce: string;
    expiry: string;
  };
  signature: `0x${string}`;
  underwriter: Address;
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
}

export interface BuildTermsArgs {
  borrower: Address;
  chainId: number;
  creditManager: Address;
  score: ScoreResult;
  nonce: bigint;
  termSeconds: number;
  ttlSeconds: number;
  underwriterPrivateKey: `0x${string}`;
  loanAssetDecimals?: number; // mUSD = 18
}

/**
 * Builds the EIP-712 LoanTerms attestation from the deterministic score and signs it with the
 * underwriter key. The signature authorizes the *bounds*; CreditManager re-checks every cap.
 */
export async function buildAndSignTerms(args: BuildTermsArgs): Promise<SignedAttestation> {
  const decimals = args.loanAssetDecimals ?? 18;
  const account = privateKeyToAccount(args.underwriterPrivateKey);

  const maxPrincipal = parseUnits(String(args.score.maxPrincipalUsd), decimals);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + args.ttlSeconds);
  const termSeconds = BigInt(args.termSeconds);
  const scoreId = BigInt(args.score.score);

  const message = {
    borrower: args.borrower,
    maxPrincipal,
    maxLtvBps: args.score.maxLtvBps,
    interestRateBps: args.score.interestRateBps,
    termSeconds,
    scoreId,
    nonce: args.nonce,
    expiry,
  } as const;

  const domain = {
    name: "Credo",
    version: "1",
    chainId: args.chainId,
    verifyingContract: args.creditManager,
  } as const;

  const signature = await account.signTypedData({
    domain,
    types: loanTermsEip712Type,
    primaryType: "LoanTerms",
    message,
  });

  return {
    terms: {
      borrower: args.borrower,
      maxPrincipal: maxPrincipal.toString(),
      maxLtvBps: args.score.maxLtvBps,
      interestRateBps: args.score.interestRateBps,
      termSeconds: termSeconds.toString(),
      scoreId: scoreId.toString(),
      nonce: args.nonce.toString(),
      expiry: expiry.toString(),
    },
    signature,
    underwriter: account.address,
    domain: { ...domain },
  };
}
