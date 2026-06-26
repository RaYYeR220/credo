import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createPublicClient, http, type Address } from "viem";
import { chainById } from "./chains.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface Deployment {
  chainId: number;
  underwriter: Address;
  treasury: Address;
  mUSD: Address;
  mETH: Address;
  priceOracle: Address;
  reputationRegistry: Address;
  lendingPool: Address;
  creditManager: Address;
}

/** Reads contracts/deployments/<chainId>.json produced by the Foundry deploy script. */
export function loadDeployment(chainId: number): Deployment {
  const path = resolve(here, "../../contracts/deployments", `${chainId}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Deployment;
  } catch {
    throw new Error(
      `No deployment for chain ${chainId} at ${path}. Deploy the contracts first ` +
        `(forge script script/Deploy.s.sol --rpc-url hsk_testnet --broadcast).`,
    );
  }
}

export interface Config {
  chainId: number;
  port: number;
  termSeconds: number;
  attestationTtlSeconds: number;
  underwriterPrivateKey?: `0x${string}`;
  anthropicApiKey?: string;
  llmModel: string;
  etherscanApiKey?: string;
}

export function loadConfig(): Config {
  return {
    chainId: Number(process.env.CHAIN_ID ?? 133),
    port: Number(process.env.PORT ?? 8787),
    termSeconds: Number(process.env.LOAN_TERM_SECONDS ?? 30 * 24 * 60 * 60),
    attestationTtlSeconds: Number(process.env.ATTESTATION_TTL_SECONDS ?? 3600),
    underwriterPrivateKey: process.env.UNDERWRITER_PRIVATE_KEY as `0x${string}` | undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    // Per the claude-api skill: default to claude-opus-4-8; override via env for cost.
    llmModel: process.env.CREDO_LLM_MODEL ?? "claude-opus-4-8",
    etherscanApiKey: process.env.ETHERSCAN_API_KEY,
  };
}

export function publicClientFor(chainId: number) {
  return createPublicClient({ chain: chainById(chainId), transport: http() });
}
