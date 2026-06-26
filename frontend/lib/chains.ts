import { defineChain } from "viem";

/** HashKey Chain mainnet — OP Stack L2, EVM. */
export const hskMainnet = defineChain({
  id: 177,
  name: "HashKey Chain",
  nativeCurrency: { name: "HashKey Platform Token", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.hsk.xyz"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://hashkey.blockscout.com" } },
});

/** HashKey Chain testnet — chain 133, free faucet at faucet.hsk.xyz. */
export const hskTestnet = defineChain({
  id: 133,
  name: "HashKey Chain Testnet",
  nativeCurrency: { name: "HashKey Platform Token", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.hsk.xyz"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://testnet-explorer.hsk.xyz" } },
  testnet: true,
});

export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 133);
