import { createPublicClient, http } from "viem";
import { hskMainnet, hskTestnet } from "@/lib/chains";

/** Resolves a Credo-supported chain definition (177 mainnet, 133 testnet). */
export function chainById(chainId: number) {
  if (chainId === hskMainnet.id) return hskMainnet;
  if (chainId === hskTestnet.id) return hskTestnet;
  throw new Error(`Unsupported chainId ${chainId} (expected 177 mainnet or 133 testnet)`);
}

/** A read-only HSK Chain client for the underwriting route handler. */
export function publicClientFor(chainId: number) {
  return createPublicClient({ chain: chainById(chainId), transport: http() });
}
