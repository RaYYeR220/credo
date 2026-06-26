/** Minimal ABI fragments the underwriter service needs to read Credo state on-chain. */

export const reputationRegistryAbi = [
  {
    type: "function",
    name: "getProfile",
    stateMutability: "view",
    inputs: [{ name: "borrower", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "loansIssued", type: "uint64" },
          { name: "loansRepaid", type: "uint64" },
          { name: "loansDefaulted", type: "uint64" },
          { name: "totalBorrowed", type: "uint256" },
          { name: "totalRepaid", type: "uint256" },
          { name: "totalDefaulted", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "onChainScore",
    stateMutability: "view",
    inputs: [{ name: "borrower", type: "address" }],
    outputs: [
      { name: "score", type: "uint16" },
      { name: "hasHistory", type: "bool" },
    ],
  },
] as const;

export const creditManagerAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "borrower", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** EIP-712 type for the underwriter attestation — must match CreditManager.LOAN_TERMS_TYPEHASH. */
export const loanTermsEip712Type = {
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
