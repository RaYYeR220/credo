import { createPublicClient, http, formatEther, type Address } from "viem";
import { mainnet } from "viem/chains";
import { reputationRegistryAbi } from "./abi.js";
import { publicClientFor, type Deployment } from "./config.js";
import type { BorrowerSignals } from "./scoring.js";

/** Demo USD price for native ETH balances. Production: pull from an oracle. */
const ETH_PRICE_USD = 3000;

export interface GatherArgs {
  address: Address;
  chainId: number;
  deployment: Deployment;
  etherscanApiKey?: string;
}

/**
 * Gathers the borrower's risk signals from cross-chain history (Ethereum mainnet) plus Credo's
 * own on-chain reputation on HSK Chain. Etherscan enrichment (wallet age, DeFi breadth) is used
 * when an API key is present; otherwise we fall back to RPC-only signals (balance + tx count).
 */
export async function gatherSignals(args: GatherArgs): Promise<BorrowerSignals> {
  const { address, chainId, deployment, etherscanApiKey } = args;

  const [credo, eth] = await Promise.all([
    readCredoReputation(chainId, deployment.reputationRegistry, address),
    readEthereumSignals(address, etherscanApiKey),
  ]);

  return {
    address,
    walletAgeDays: eth.walletAgeDays,
    txCount: eth.txCount,
    balanceUsd: eth.balanceUsd,
    defiProtocolsUsed: eth.defiProtocolsUsed,
    priorLiquidations: eth.priorLiquidations,
    credo,
  };
}

async function readCredoReputation(
  chainId: number,
  registry: Address,
  borrower: Address,
): Promise<BorrowerSignals["credo"]> {
  try {
    const client = publicClientFor(chainId);
    const profile = await client.readContract({
      address: registry,
      abi: reputationRegistryAbi,
      functionName: "getProfile",
      args: [borrower],
    });
    const loansRepaid = Number(profile.loansRepaid);
    const loansDefaulted = Number(profile.loansDefaulted);
    return { loansRepaid, loansDefaulted, hasHistory: loansRepaid + loansDefaulted > 0 };
  } catch {
    return { loansRepaid: 0, loansDefaulted: 0, hasHistory: false };
  }
}

interface EthSignals {
  walletAgeDays: number;
  txCount: number;
  balanceUsd: number;
  defiProtocolsUsed: number;
  priorLiquidations: number;
}

async function readEthereumSignals(address: Address, etherscanApiKey?: string): Promise<EthSignals> {
  const ethRpc = process.env.ETH_RPC_URL;
  // Fail fast: a slow/blocked public RPC must not hang underwriting. Fresh wallets just score 0 here.
  const client = createPublicClient({
    chain: mainnet,
    transport: http(ethRpc, { timeout: 4000, retryCount: 0 }),
  });

  // RPC-only signals (no API key needed)
  const [balanceWei, nonce] = await Promise.all([
    client.getBalance({ address }).catch(() => 0n),
    client.getTransactionCount({ address }).catch(() => 0),
  ]);
  const balanceUsd = Number(formatEther(balanceWei)) * ETH_PRICE_USD;

  let walletAgeDays = 0;
  let txCount = nonce;
  let defiProtocolsUsed = 0;
  const priorLiquidations = 0; // not reliably derivable without indexed logs; conservative default

  if (etherscanApiKey) {
    const enriched = await readEtherscanHistory(address, etherscanApiKey);
    if (enriched) {
      walletAgeDays = enriched.walletAgeDays;
      txCount = Math.max(txCount, enriched.txCount);
      defiProtocolsUsed = enriched.defiProtocolsUsed;
    }
  }

  return { walletAgeDays, txCount, balanceUsd, defiProtocolsUsed, priorLiquidations };
}

interface EtherscanEnrichment {
  walletAgeDays: number;
  txCount: number;
  defiProtocolsUsed: number;
}

/** Etherscan V2 multichain API — one key works across chains. Reads Ethereum mainnet (chainid=1). */
async function readEtherscanHistory(
  address: Address,
  apiKey: string,
): Promise<EtherscanEnrichment | null> {
  const url =
    `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist` +
    `&address=${address}&startblock=0&endblock=99999999&sort=asc&apikey=${apiKey}`;
  try {
    const res = await fetch(url);
    const json = (await res.json()) as { status: string; result: EtherscanTx[] };
    if (json.status !== "1" || !Array.isArray(json.result) || json.result.length === 0) {
      return null;
    }
    const txs = json.result;
    const firstTs = Number(txs[0]!.timeStamp) * 1000;
    const walletAgeDays = Math.max(0, Math.floor((Date.now() - firstTs) / 86_400_000));
    // distinct contract counterparties (txs that hit a contract with calldata) as a DeFi proxy
    const contracts = new Set(
      txs.filter((t) => t.input && t.input !== "0x" && t.to).map((t) => t.to.toLowerCase()),
    );
    return { walletAgeDays, txCount: txs.length, defiProtocolsUsed: contracts.size };
  } catch {
    return null;
  }
}

interface EtherscanTx {
  timeStamp: string;
  to: string;
  input: string;
}
