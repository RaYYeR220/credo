/**
 * End-to-end demo / verification on the live chain:
 *   underwrite(borrower) -> EIP-712 attestation (signed by the underwriter service key)
 *   -> approve collateral -> CreditManager.borrow(...) -> loan issued on-chain.
 *
 * Proves the full off-chain -> on-chain stack: the signature the TS service produces is accepted
 * by the Solidity contract. The borrower wallet is the deployer (it holds mETH collateral + gas).
 *
 * Usage: pnpm tsx src/demo.ts [principalMUSD] [collateralMETH]   (defaults: 1000 mUSD / 1 mETH)
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById } from "./chains.js";
import { loadDeployment } from "./config.js";
import { underwrite } from "./underwrite.js";

const here = dirname(fileURLToPath(import.meta.url));

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
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

const creditManagerAbi = [
  { type: "function", name: "borrow", stateMutability: "nonpayable", inputs: [loanTermsTuple, { name: "signature", type: "bytes" }, { name: "principal", type: "uint256" }, { name: "collateralAmount", type: "uint256" }], outputs: [{ name: "loanId", type: "uint256" }] },
  { type: "function", name: "loansCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ltvBps", stateMutability: "view", inputs: [{ name: "p", type: "uint256" }, { name: "c", type: "uint256" }], outputs: [{ type: "uint16" }] },
] as const;

async function main() {
  const chainId = Number(process.argv[4] ?? 133);
  const chain = chainById(chainId);
  const deployment = loadDeployment(chainId);

  // borrower = deployer (holds mETH + gas); pk read from contracts/.env
  const contractsEnv = readFileSync(resolve(here, "../../contracts/.env"), "utf8");
  const m = contractsEnv.match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/);
  if (!m) throw new Error("deployer PRIVATE_KEY not found in contracts/.env");
  const account = privateKeyToAccount(m[1] as `0x${string}`);
  const borrower = account.address;

  const principal = parseEther(process.argv[2] ?? "1000"); // mUSD (18 dec)
  const collateral = parseEther(process.argv[3] ?? "1"); // mETH (18 dec)

  console.log(`\n=== Credo e2e demo — borrower ${borrower} on chain ${chainId} ===`);

  // 1. Underwrite -> signed attestation
  const r = await underwrite(borrower, chainId);
  if (!r.attestation) throw new Error("no attestation (underwriter key missing?)");
  console.log(`Score ${r.score.score}/1000 (tier ${r.score.tier}) — maxLTV ${r.score.maxLtvBps / 100}% · rate ${r.score.interestRateBps / 100}% · max $${r.score.maxPrincipalUsd.toLocaleString("en-US")}`);
  console.log(`Rationale (${r.rationale.source}): ${r.rationale.text}`);

  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });

  const t = r.attestation.terms;
  const terms = {
    borrower: t.borrower,
    maxPrincipal: BigInt(t.maxPrincipal),
    maxLtvBps: t.maxLtvBps,
    interestRateBps: t.interestRateBps,
    termSeconds: BigInt(t.termSeconds),
    scoreId: BigInt(t.scoreId),
    nonce: BigInt(t.nonce),
    expiry: BigInt(t.expiry),
  } as const;

  const realizedLtv = await pub.readContract({ address: deployment.creditManager, abi: creditManagerAbi, functionName: "ltvBps", args: [principal, collateral] });
  console.log(`\nBorrowing ${formatEther(principal)} mUSD against ${formatEther(collateral)} mETH → realized LTV ${Number(realizedLtv) / 100}% (cap ${terms.maxLtvBps / 100}%)`);

  // 2. Approve collateral
  console.log("approve mETH…");
  const approveHash = await wallet.writeContract({ address: deployment.mETH, abi: erc20Abi, functionName: "approve", args: [deployment.creditManager, collateral] });
  await pub.waitForTransactionReceipt({ hash: approveHash });
  console.log(`  approve tx: ${approveHash}`);

  // 3. Borrow
  console.log("borrow…");
  const borrowHash = await wallet.writeContract({ address: deployment.creditManager, abi: creditManagerAbi, functionName: "borrow", args: [terms, r.attestation.signature, principal, collateral] });
  const rcpt = await pub.waitForTransactionReceipt({ hash: borrowHash });
  console.log(`  borrow tx: ${borrowHash}  (block ${rcpt.blockNumber}, status ${rcpt.status})`);

  const count = await pub.readContract({ address: deployment.creditManager, abi: creditManagerAbi, functionName: "loansCount" });
  console.log(`\n✅ Loan issued. Total loans on-chain: ${count}`);
  console.log(`   Explorer: ${chain.blockExplorers?.default.url}/tx/${borrowHash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
