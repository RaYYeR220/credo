"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { TopBar } from "@/components/Nav";
import { creditManagerAbi, erc20Abi, reputationRegistryAbi } from "@/lib/abis";
import { getDeployment } from "@/lib/deployments";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";

const CHAIN_ID = DEFAULT_CHAIN_ID;
const fmt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const STATUS = ["None", "Active", "Repaid", "Defaulted"] as const;

interface Profile { loansIssued: bigint; loansRepaid: bigint; loansDefaulted: bigint; totalBorrowed: bigint; totalRepaid: bigint; totalDefaulted: bigint; }
interface LoanRow { id: number; principal: bigint; collateral: bigint; dueTime: number; status: number; owed: bigint; }

export default function DashboardPage() {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const dep = getDeployment(CHAIN_ID);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [score, setScore] = useState<{ score: number; hasHistory: boolean } | null>(null);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; err?: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!dep || !publicClient || !address) return;
    const p = (await publicClient.readContract({ address: dep.reputationRegistry, abi: reputationRegistryAbi, functionName: "getProfile", args: [address] })) as Profile;
    setProfile(p);
    const sc = (await publicClient.readContract({ address: dep.reputationRegistry, abi: reputationRegistryAbi, functionName: "onChainScore", args: [address] })) as [number, boolean];
    setScore({ score: Number(sc[0]), hasHistory: sc[1] });

    const count = Number(await publicClient.readContract({ address: dep.creditManager, abi: creditManagerAbi, functionName: "loansCount" }));
    const rows: LoanRow[] = [];
    for (let i = 0; i < count; i++) {
      const loan = (await publicClient.readContract({ address: dep.creditManager, abi: creditManagerAbi, functionName: "getLoan", args: [BigInt(i)] })) as {
        borrower: string; principal: bigint; collateralAmount: bigint; interestRateBps: number; startTime: bigint; dueTime: bigint; status: number;
      };
      if (loan.borrower.toLowerCase() !== address.toLowerCase()) continue;
      const owed = loan.status === 1
        ? ((await publicClient.readContract({ address: dep.creditManager, abi: creditManagerAbi, functionName: "amountOwed", args: [BigInt(i)] })) as bigint)
        : 0n;
      rows.push({ id: i, principal: loan.principal, collateral: loan.collateralAmount, dueTime: Number(loan.dueTime), status: loan.status, owed });
    }
    setLoans(rows);
  }, [dep, publicClient, address]);

  useEffect(() => { void load(); }, [load]);

  async function repay(loan: LoanRow) {
    if (!dep || !publicClient || !address) return;
    setNotice(null);
    setBusy(loan.id);
    try {
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID });
      // approve a small buffer over current owed (interest keeps accruing until the repay tx lands)
      const buffer = loan.owed + loan.owed / 50n; // +2%
      const bal = (await publicClient.readContract({ address: dep.mUSD, abi: erc20Abi, functionName: "balanceOf", args: [address] })) as bigint;
      if (bal < buffer) {
        const hm = await writeContractAsync({ address: dep.mUSD, abi: erc20Abi, functionName: "mint", args: [address, buffer - bal] });
        await publicClient.waitForTransactionReceipt({ hash: hm });
      }
      const ha = await writeContractAsync({ address: dep.mUSD, abi: erc20Abi, functionName: "approve", args: [dep.creditManager, buffer] });
      await publicClient.waitForTransactionReceipt({ hash: ha });
      const hr = await writeContractAsync({ address: dep.creditManager, abi: creditManagerAbi, functionName: "repay", args: [BigInt(loan.id)] });
      await publicClient.waitForTransactionReceipt({ hash: hr });
      setNotice({ text: `Loan #${loan.id} repaid ✓ — reputation updated` });
      await load();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message.split("\n")[0] : "Repay failed", err: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <TopBar />
      {notice && <div className={`notice${notice.err ? " err" : ""}`}>{notice.text}</div>}
      <main className="page">
        <section className="panel rv d2">
          <div className="eyebrow">Borrower</div>
          <h1>Your credit dashboard</h1>
          <p className="lead">Your Credo on-chain reputation and active loans. Repaying on time lifts your score; defaults lower it — the reputation flywheel.</p>

          {!isConnected ? (
            <p className="muted">Connect a wallet to view your reputation and loans.</p>
          ) : (
            <>
              <h2>On-chain reputation</h2>
              <div className="statrow">
                <div className="stat"><div className="k">Credo score</div><div className="v">{score ? (score.hasHistory ? `${score.score}/1000` : "—") : "…"}</div></div>
                <div className="stat"><div className="k">Issued</div><div className="v">{profile ? String(profile.loansIssued) : "—"}</div></div>
                <div className="stat"><div className="k">Repaid</div><div className="v">{profile ? String(profile.loansRepaid) : "—"}</div></div>
                <div className="stat"><div className="k">Defaulted</div><div className="v">{profile ? String(profile.loansDefaulted) : "—"}</div></div>
              </div>

              <h2>Loans</h2>
              {loans.length === 0 ? (
                <p className="muted">No loans yet. Get an assessment on the <a href="/" style={{ color: "var(--oxblood)" }}>Borrow</a> page.</p>
              ) : (
                loans.map((l) => (
                  <div className="loan" key={l.id}>
                    <span className="lid">#{l.id}</span>
                    <span className="ldetail">
                      {fmt(l.principal)} mUSD · {fmt(l.collateral)} mETH collateral
                      {l.status === 1 && <> · owed {fmt(l.owed)} · due {new Date(l.dueTime * 1000).toLocaleDateString()}</>}
                    </span>
                    {l.status === 1 ? (
                      <button className="btn solid" style={{ padding: "10px 18px", fontSize: 14 }} disabled={busy !== null} onClick={() => repay(l)}>
                        {busy === l.id ? "Repaying…" : "Repay"}
                      </button>
                    ) : (
                      <span className={`lstatus ${STATUS[l.status]?.toLowerCase()}`}>{STATUS[l.status]}</span>
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
