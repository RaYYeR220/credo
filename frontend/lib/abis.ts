/** ABI fragments the frontend needs. Hand-written to keep the bundle lean. */

export const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  // MockERC20 helper (demo only — anyone can mint test tokens)
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

export const priceOracleAbi = [
  { type: "function", name: "priceUsd", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const loanTermsTuple = {
  name: "terms",
  type: "tuple",
  components: [
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

const loanTuple = {
  type: "tuple",
  components: [
    { name: "borrower", type: "address" },
    { name: "principal", type: "uint256" },
    { name: "collateralAmount", type: "uint256" },
    { name: "interestRateBps", type: "uint16" },
    { name: "startTime", type: "uint64" },
    { name: "dueTime", type: "uint64" },
    { name: "status", type: "uint8" },
  ],
} as const;

export const creditManagerAbi = [
  { type: "function", name: "borrow", stateMutability: "nonpayable", inputs: [loanTermsTuple, { name: "signature", type: "bytes" }, { name: "principal", type: "uint256" }, { name: "collateralAmount", type: "uint256" }], outputs: [{ name: "loanId", type: "uint256" }] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "loanId", type: "uint256" }], outputs: [] },
  { type: "function", name: "liquidate", stateMutability: "nonpayable", inputs: [{ name: "loanId", type: "uint256" }], outputs: [] },
  { type: "function", name: "getLoan", stateMutability: "view", inputs: [{ name: "loanId", type: "uint256" }], outputs: [loanTuple] },
  { type: "function", name: "loansCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ltvBps", stateMutability: "view", inputs: [{ name: "principal", type: "uint256" }, { name: "collateralAmount", type: "uint256" }], outputs: [{ type: "uint16" }] },
  { type: "function", name: "amountOwed", stateMutability: "view", inputs: [{ name: "loanId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "underwriter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "event", name: "LoanOpened", inputs: [{ name: "loanId", type: "uint256", indexed: true }, { name: "borrower", type: "address", indexed: true }, { name: "principal", type: "uint256", indexed: false }, { name: "collateralAmount", type: "uint256", indexed: false }, { name: "ltvBps", type: "uint16", indexed: false }, { name: "interestRateBps", type: "uint16", indexed: false }, { name: "dueTime", type: "uint64", indexed: false }] },
] as const;

export const lendingPoolAbi = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ name: "shares", type: "uint256" }] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ name: "assets", type: "uint256" }] },
  { type: "function", name: "maxWithdraw", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "convertToAssets", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalOutstanding", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "availableToLend", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const reputationRegistryAbi = [
  { type: "function", name: "getProfile", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "tuple", components: [{ name: "loansIssued", type: "uint64" }, { name: "loansRepaid", type: "uint64" }, { name: "loansDefaulted", type: "uint64" }, { name: "totalBorrowed", type: "uint256" }, { name: "totalRepaid", type: "uint256" }, { name: "totalDefaulted", type: "uint256" }] }] },
  { type: "function", name: "onChainScore", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ name: "score", type: "uint16" }, { name: "hasHistory", type: "bool" }] },
] as const;
