"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits, parseEther } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { TopBar } from "@/components/Nav";
import { erc20Abi, lendingPoolAbi } from "@/lib/abis";
import { getDeployment } from "@/lib/deployments";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";

const CHAIN_ID = DEFAULT_CHAIN_ID;
const fmt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });

interface PoolState {
  totalAssets: bigint;
  outstanding: bigint;
  available: bigint;
  shares: bigint;
  position: bigint;
  usdBalance: bigint;
  allowance: bigint;
}

export default function LendPage() {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const dep = getDeployment(CHAIN_ID);

  const [s, setS] = useState<PoolState | null>(null);
  const [amount, setAmount] = useState("10000");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; err?: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!dep || !publicClient) return;
    const [totalAssets, outstanding, available] = await Promise.all([
      publicClient.readContract({ address: dep.lendingPool, abi: lendingPoolAbi, functionName: "totalAssets" }),
      publicClient.readContract({ address: dep.lendingPool, abi: lendingPoolAbi, functionName: "totalOutstanding" }),
      publicClient.readContract({ address: dep.lendingPool, abi: lendingPoolAbi, functionName: "availableToLend" }),
    ]);
    let shares = 0n, position = 0n, usdBalance = 0n, allowance = 0n;
    if (address) {
      shares = (await publicClient.readContract({ address: dep.lendingPool, abi: lendingPoolAbi, functionName: "balanceOf", args: [address] })) as bigint;
      position = (await publicClient.readContract({ address: dep.lendingPool, abi: lendingPoolAbi, functionName: "convertToAssets", args: [shares] })) as bigint;
      usdBalance = (await publicClient.readContract({ address: dep.mUSD, abi: erc20Abi, functionName: "balanceOf", args: [address] })) as bigint;
      allowance = (await publicClient.readContract({ address: dep.mUSD, abi: erc20Abi, functionName: "allowance", args: [address, dep.lendingPool] })) as bigint;
    }
    setS({ totalAssets: totalAssets as bigint, outstanding: outstanding as bigint, available: available as bigint, shares, position, usdBalance, allowance });
  }, [dep, publicClient, address]);

  useEffect(() => { void load(); }, [load]);

  async function ensureChain() {
    if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID });
  }

  async function run(label: string, fn: () => Promise<void>) {
    setNotice(null);
    setBusy(label);
    try {
      await ensureChain();
      await fn();
      await load();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message.split("\n")[0] : "Transaction failed", err: true });
    } finally {
      setBusy(null);
    }
  }

  const mintTestUsd = () =>
    run("mint", async () => {
      if (!dep || !publicClient || !address) return;
      const h = await writeContractAsync({ address: dep.mUSD, abi: erc20Abi, functionName: "mint", args: [address, parseEther("100000")] });
      await publicClient.waitForTransactionReceipt({ hash: h });
      setNotice({ text: "Minted 100,000 test mUSD ✓" });
    });

  const deposit = () =>
    run("deposit", async () => {
      if (!dep || !publicClient || !address || !s) return;
      const amt = parseEther(amount || "0");
      if (amt <= 0n) throw new Error("Enter an amount");
      if (s.allowance < amt) {
        const ha = await writeContractAsync({ address: dep.mUSD, abi: erc20Abi, functionName: "approve", args: [dep.lendingPool, amt] });
        await publicClient.waitForTransactionReceipt({ hash: ha });
      }
      const hd = await writeContractAsync({ address: dep.lendingPool, abi: lendingPoolAbi, functionName: "deposit", args: [amt, address] });
      await publicClient.waitForTransactionReceipt({ hash: hd });
      setNotice({ text: `Deposited ${amount} mUSD ✓` });
    });

  const withdrawAll = () =>
    run("withdraw", async () => {
      if (!dep || !publicClient || !address || !s || s.shares <= 0n) throw new Error("Nothing to withdraw");
      const h = await writeContractAsync({ address: dep.lendingPool, abi: lendingPoolAbi, functionName: "redeem", args: [s.shares, address, address] });
      await publicClient.waitForTransactionReceipt({ hash: h });
      setNotice({ text: "Withdrew your full position ✓" });
    });

  const util = s && s.totalAssets > 0n ? (Number(s.outstanding) / Number(s.totalAssets)) * 100 : 0;

  return (
    <>
      <TopBar />
      {notice && <div className={`notice${notice.err ? " err" : ""}`}>{notice.text}</div>}
      <main className="page">
        <section className="panel rv d2">
          <div className="eyebrow">Lender pool</div>
          <h1>Provide liquidity</h1>
          <p className="lead">Deposit mUSD to fund AI-underwritten loans. Interest accrues to your share price; defaults are socialised across the pool.</p>

          <h2>Pool</h2>
          <div className="statrow">
            <div className="stat"><div className="k">Total assets</div><div className="v">{s ? fmt(s.totalAssets) : "—"}</div></div>
            <div className="stat"><div className="k">Lent out</div><div className="v">{s ? fmt(s.outstanding) : "—"}</div></div>
            <div className="stat"><div className="k">Available</div><div className="v">{s ? fmt(s.available) : "—"}</div></div>
            <div className="stat"><div className="k">Utilization</div><div className="v">{s ? `${util.toFixed(1)}%` : "—"}</div></div>
          </div>

          <h2>Your position</h2>
          <div className="statrow">
            <div className="stat"><div className="k">Deposited (value)</div><div className="v">{s ? fmt(s.position) : "—"}</div></div>
            <div className="stat"><div className="k">Wallet mUSD</div><div className="v">{s ? fmt(s.usdBalance) : "—"}</div></div>
          </div>

          {!isConnected ? (
            <p className="muted">Connect a wallet to deposit.</p>
          ) : (
            <>
              <div className="formrow">
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount in mUSD" />
                <button className="btn solid" disabled={!!busy} onClick={deposit}>{busy === "deposit" ? "Depositing…" : "Deposit"}</button>
                <button className="btn outline" disabled={!!busy || !s || s.shares <= 0n} onClick={withdrawAll}>{busy === "withdraw" ? "Withdrawing…" : "Withdraw all"}</button>
              </div>
              <p className="muted">
                Need test funds? <button className="btn outline" style={{ padding: "4px 10px", fontSize: 12 }} disabled={!!busy} onClick={mintTestUsd}>{busy === "mint" ? "Minting…" : "Mint 100k test mUSD"}</button>
              </p>
            </>
          )}
        </section>
      </main>
    </>
  );
}
