"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { injected } from "wagmi/connectors";
import { hskMainnet, hskTestnet } from "@/lib/chains";

const config = createConfig({
  chains: [hskTestnet, hskMainnet],
  connectors: [injected()],
  transports: {
    [hskTestnet.id]: http(),
    [hskMainnet.id]: http(),
  },
  ssr: true,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
