"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { Statement } from "@/components/Statement";
import { TopBar } from "@/components/Nav";
import { creditManagerAbi, erc20Abi, priceOracleAbi } from "@/lib/abis";
import { getDeployment } from "@/lib/deployments";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";
import { collateralForPrincipal, requestUnderwriting, toStatementData, type StatementData, type UnderwriteResult } from "@/lib/credo";

const DEMO_DATA: StatementData = {
  borrower: "0x9937…0f07",
  borrowerLabel: "demo borrower",
  reportNo: "CRD-0842",
  issued: "sample",
  score: 842,
  max: 1000,
  tier: "A",
  determination: "Approved · under-collateralized",
  offer: { amount: "42,650", collateral: "40%", ltv: "250%", rate: "8.0% APR", term: "30 days" },
  rationale:
    "Tier A (842/1000): a flawless liquidation record and a perfect 3-of-3 Credo repayment history anchor this score, backed by substantial on-chain holdings ($38.4K) and a 920-day wallet. DeFi breadth (7 protocols) is the only material drag. The protocol extends up to $42,650 at 8.0% APR over 30 days — every parameter enforced on-chain.",
  signals: [
    { n: "01", name: "Wallet age", sub: "Account longevity", reading: "920 days", weight: "18%", points: 151, drag: false },
    { n: "02", name: "Transaction activity", sub: "Ledger throughput", reading: "430 txns", weight: "14%", points: 137, drag: false },
    { n: "03", name: "Holdings", sub: "Skin in the game", reading: "$38,400", weight: "20%", points: 181, drag: false },
    { n: "04", name: "DeFi sophistication", sub: "Protocol breadth", reading: "7 protocols", weight: "10%", points: 70, drag: true },
    { n: "05", name: "Prior liquidations", sub: "Default record", reading: "0 — flawless", weight: "18%", points: 180, drag: false },
    { n: "06", name: "Credo repayment history", sub: "Prior obligations", reading: "3 / 3 repaid", weight: "20%", points: 123, drag: false },
  ],
};

const CHAIN_ID = DEFAULT_CHAIN_ID;

export default function Home() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });

  const [assessment, setAssessment] = useState<UnderwriteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ text: string; err?: boolean } | null>(null);
  const [tx, setTx] = useState<"idle" | "minting" | "approving" | "borrowing" | "done">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);

  const data = assessment ? toStatementData(assessment) : DEMO_DATA;
  const live = Boolean(assessment);

  async function handleAssess() {
    if (!address) return;
    setLoading(true);
    setNotice(null);
    setTx("idle");
    setTxHash(null);
    try {
      const r = await requestUnderwriting(address, CHAIN_ID);
      setAssessment(r);
      if (!r.attestation) setNotice({ text: "Quote returned unsigned — underwriter key not configured.", err: true });
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "Underwriting failed", err: true });
    } finally {
      setLoading(false);
    }
  }

  async function handleTakeLoan() {
    if (!assessment?.attestation || !address || !publicClient) return;
    const dep = getDeployment(CHAIN_ID);
    if (!dep) {
      setNotice({ text: `Credo is not deployed on chain ${CHAIN_ID}.`, err: true });
      return;
    }
    setNotice(null);
    try {
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID });

      const principalUsd = assessment.score.maxPrincipalUsd;
      const principal = parseEther(String(principalUsd));
      const ethPrice8 = (await publicClient.readContract({
        address: dep.priceOracle,
        abi: priceOracleAbi,
        functionName: "priceUsd",
        args: [dep.mETH],
      })) as bigint;
      const collateral = collateralForPrincipal(principalUsd, assessment.score.maxLtvBps, ethPrice8);

      const bal = (await publicClient.readContract({
        address: dep.mETH,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;

      if (bal < collateral) {
        setTx("minting");
        const h = await writeContractAsync({ address: dep.mETH, abi: erc20Abi, functionName: "mint", args: [address, collateral - bal] });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }

      setTx("approving");
      const ha = await writeContractAsync({ address: dep.mETH, abi: erc20Abi, functionName: "approve", args: [dep.creditManager, collateral] });
      await publicClient.waitForTransactionReceipt({ hash: ha });

      setTx("borrowing");
      const t = assessment.attestation.terms;
      const terms = {
        borrower: t.borrower,
        maxPrincipal: BigInt(t.maxPrincipal),
        maxLtvBps: t.maxLtvBps,
        interestRateBps: t.interestRateBps,
        termSeconds: BigInt(t.termSeconds),
        scoreId: BigInt(t.scoreId),
        nonce: BigInt(t.nonce),
        expiry: BigInt(t.expiry),
      };
      const hb = await writeContractAsync({
        address: dep.creditManager,
        abi: creditManagerAbi,
        functionName: "borrow",
        args: [terms, assessment.attestation.signature, principal, collateral],
      });
      await publicClient.waitForTransactionReceipt({ hash: hb });

      setTx("done");
      setTxHash(hb);
      setNotice({ text: "Loan issued on-chain ✓" });
    } catch (e) {
      setTx("idle");
      setNotice({ text: e instanceof Error ? e.message.split("\n")[0] : "Transaction failed", err: true });
    }
  }

  // --- CTA shown inside the action band ---
  let cta: React.ReactNode;
  if (!live) {
    cta = (
      <>
        <button className="btn primary" type="button" disabled={!isConnected || loading} onClick={handleAssess}>
          {loading ? "Assessing…" : "Assess my wallet"} <span className="arr">→</span>
        </button>
        <div className="cta-note">
          {isConnected ? "Reads your on-chain history · signs an attestation" : "Connect a wallet to get a live assessment"}
        </div>
      </>
    );
  } else if (tx === "done") {
    cta = (
      <>
        <a className="btn primary" href={`https://testnet-explorer.hsk.xyz/tx/${txHash}`} target="_blank" rel="noopener">
          View loan on explorer <span className="arr">↗</span>
        </a>
        <button className="btn ghost" type="button" onClick={() => { setAssessment(null); setTx("idle"); setNotice(null); }}>
          New assessment
        </button>
        <div className="cta-note">Loan active · repay before term to lift your reputation</div>
      </>
    );
  } else {
    const busy = tx !== "idle";
    const label = tx === "minting" ? "Minting test collateral…" : tx === "approving" ? "Approving collateral…" : tx === "borrowing" ? "Issuing loan…" : "Take loan";
    cta = (
      <>
        <button className="btn primary" type="button" disabled={busy || !assessment.attestation} onClick={handleTakeLoan}>
          {label} {!busy && <span className="arr">→</span>}
        </button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => { setAssessment(null); setNotice(null); }}>
          New assessment
        </button>
        <div className="cta-note">Signing happens in your wallet · test collateral is minted for you</div>
      </>
    );
  }

  return (
    <>
      <TopBar />

      {notice && <div className={`notice${notice.err ? " err" : ""}`}>{notice.text}</div>}

      <Statement data={data} cta={cta} />
    </>
  );
}
