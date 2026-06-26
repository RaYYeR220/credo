/**
 * Repay an open loan and show the reputation flywheel move (loansRepaid++) on the live chain.
 * Usage: pnpm tsx src/repay.ts [loanId]   (default loanId 0)
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hskTestnet } from "./chains.js";
import { loadDeployment } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amt", type: "uint256" }], outputs: [] },
] as const;

const cmAbi = [
  { type: "function", name: "amountOwed", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "getLoan", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "tuple", components: [{ name: "borrower", type: "address" }, { name: "principal", type: "uint256" }, { name: "collateralAmount", type: "uint256" }, { name: "interestRateBps", type: "uint16" }, { name: "startTime", type: "uint64" }, { name: "dueTime", type: "uint64" }, { name: "status", type: "uint8" }] }] },
] as const;

const repAbi = [
  { type: "function", name: "getProfile", stateMutability: "view", inputs: [{ name: "b", type: "address" }], outputs: [{ type: "tuple", components: [{ name: "loansIssued", type: "uint64" }, { name: "loansRepaid", type: "uint64" }, { name: "loansDefaulted", type: "uint64" }, { name: "totalBorrowed", type: "uint256" }, { name: "totalRepaid", type: "uint256" }, { name: "totalDefaulted", type: "uint256" }] }] },
] as const;

async function main() {
  const chainId = 133;
  const dep = loadDeployment(chainId);
  const loanId = BigInt(process.argv[2] ?? "0");

  const env = readFileSync(resolve(here, "../../contracts/.env"), "utf8");
  const pk = env.match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)![1] as `0x${string}`;
  const account = privateKeyToAccount(pk);

  const pub = createPublicClient({ chain: hskTestnet, transport: http() });
  const wallet = createWalletClient({ account, chain: hskTestnet, transport: http() });

  const before = (await pub.readContract({ address: dep.reputationRegistry, abi: repAbi, functionName: "getProfile", args: [account.address] })) as { loansIssued: bigint; loansRepaid: bigint; loansDefaulted: bigint };
  console.log(`\nReputation BEFORE: issued ${before.loansIssued}, repaid ${before.loansRepaid}, defaulted ${before.loansDefaulted}`);

  const owed = (await pub.readContract({ address: dep.creditManager, abi: cmAbi, functionName: "amountOwed", args: [loanId] })) as bigint;
  console.log(`Loan #${loanId} owed: ${formatEther(owed)} mUSD`);
  if (owed === 0n) { console.log("Loan not active (already settled?). Nothing to repay."); return; }

  const buffer = owed + owed / 50n; // +2% headroom for interest accrual
  const bal = (await pub.readContract({ address: dep.mUSD, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
  if (bal < buffer) {
    console.log("minting top-up mUSD for interest…");
    const hm = await wallet.writeContract({ address: dep.mUSD, abi: erc20Abi, functionName: "mint", args: [account.address, buffer - bal] });
    await pub.waitForTransactionReceipt({ hash: hm });
  }
  const ha = await wallet.writeContract({ address: dep.mUSD, abi: erc20Abi, functionName: "approve", args: [dep.creditManager, buffer] });
  await pub.waitForTransactionReceipt({ hash: ha });

  console.log("repay…");
  const hr = await wallet.writeContract({ address: dep.creditManager, abi: cmAbi, functionName: "repay", args: [loanId] });
  const rcpt = await pub.waitForTransactionReceipt({ hash: hr });

  const loan = (await pub.readContract({ address: dep.creditManager, abi: cmAbi, functionName: "getLoan", args: [loanId] })) as { status: number };
  const after = (await pub.readContract({ address: dep.reputationRegistry, abi: repAbi, functionName: "getProfile", args: [account.address] })) as { loansIssued: bigint; loansRepaid: bigint; loansDefaulted: bigint };

  console.log(`repay tx: ${hr} (block ${rcpt.blockNumber}, status ${rcpt.status})`);
  console.log(`Loan #${loanId} status: ${["None", "Active", "Repaid", "Defaulted"][loan.status]}`);
  console.log(`Reputation AFTER:  issued ${after.loansIssued}, repaid ${after.loansRepaid}, defaulted ${after.loansDefaulted}`);
  console.log(`\n✅ Flywheel: loansRepaid ${before.loansRepaid} → ${after.loansRepaid}`);
  console.log(`   Explorer: https://testnet-explorer.hsk.xyz/tx/${hr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
