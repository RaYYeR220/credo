"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";

const NET = DEFAULT_CHAIN_ID === 177 ? { label: "Mainnet", id: 177 } : { label: "Testnet", id: 133 };

export function WalletControl() {
  const [mounted, setMounted] = useState(false);
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="chip wallet"><span className="dot" /><span className="addr">…</span></span>;
  if (isConnected && address) {
    return (
      <button className="chip wallet" onClick={() => disconnect()} title="Disconnect" style={{ cursor: "pointer" }}>
        <span className="dot" aria-hidden="true" />
        <span className="addr">{`${address.slice(0, 6)}…${address.slice(-4)}`}</span>
        <span className="lbl">disconnect</span>
      </button>
    );
  }
  const injected = connectors[0];
  return (
    <button className="btn-connect" disabled={isPending || !injected} onClick={() => injected && connect({ connector: injected })}>
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

export function TopBar() {
  return (
    <div className="topbar rv d1">
      <span className="chip pool" aria-label="Network">
        <span>HashKey Chain</span>
        <span className="sep" />
        <span>{NET.label} <b>{NET.id}</b></span>
      </span>
      <div className="topbar-actions">
        <a className="navlink" href="/">Borrow</a>
        <a className="navlink" href="/lend">Lend</a>
        <a className="navlink" href="/dashboard">Dashboard</a>
        <WalletControl />
      </div>
    </div>
  );
}
