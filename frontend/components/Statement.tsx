"use client";

import { useEffect, useRef } from "react";
import type { StatementData } from "@/lib/credo";
import { maxPoints } from "@/lib/credo";

/** Renders the Credo "Statement of Credit Assessment" document (the approved final-b design)
 *  from a view-model. The CTA area is injected so demo vs. live flows can differ. */
export function Statement({
  data,
  cta,
  sample = false,
}: {
  data: StatementData;
  cta: React.ReactNode;
  sample?: boolean;
}) {
  const fillRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<(HTMLElement | null)[]>([]);
  const top = maxPoints(data.signals);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const meterPct = (data.score / data.max) * 100;
    const setBars = () =>
      barRefs.current.forEach((el, i) => {
        const s = data.signals[i];
        if (el && s) el.style.width = `${Math.round((s.points / top) * 100)}%`;
      });
    if (reduce) {
      if (fillRef.current) fillRef.current.style.width = `${meterPct}%`;
      setBars();
      return;
    }
    const id = requestAnimationFrame(() => {
      if (fillRef.current) fillRef.current.style.width = `${meterPct}%`;
    });
    const timers = data.signals.map((s, i) =>
      setTimeout(() => {
        const el = barRefs.current[i];
        if (el) el.style.width = `${Math.round((s.points / top) * 100)}%`;
      }, 600 + i * 80),
    );
    return () => {
      cancelAnimationFrame(id);
      timers.forEach(clearTimeout);
    };
  }, [data, top]);

  return (
    <div className="doc">
      {sample && (
        <div className="sample-banner">
          <b>◆ Sample ◆</b>
          <span>Connect a wallet for a live, AI-underwritten assessment of your own history</span>
        </div>
      )}
      <header className="masthead">
        <div className="reg-row rv d1">
          <span>Report № {data.reportNo}</span>
          <span>Issued {data.issued} · HashKey Chain</span>
        </div>
        <div className="crest rv d1">◆ Office of On-Chain Creditworthiness ◆</div>
        <h1 className="brand rv d2">Credo</h1>
        <div className="brand-sub rv d2">Statement of Credit Assessment</div>
        <div className="tagline rv d2">AI credit underwriting · under-collateralized lending on HashKey Chain</div>
      </header>
      <div className="dbl-rule rv d2" />

      <div className="body-pad">
        <div className="subject rv d3">
          <div className="field">
            <span>Subject / Borrower</span>
            <b>{data.borrower}</b> — {data.borrowerLabel}
          </div>
          <div className="field">
            <span>Determination</span>
            <b>{data.determination}</b>
          </div>
          <div className="field">
            <span>Methodology</span>
            <b>Deterministic · auditable</b>
          </div>
        </div>

        <div className="hero">
          <div className="score-wrap rv d3">
            <div className="stamp" aria-hidden="true">
              <svg viewBox="0 0 100 100">
                <defs>
                  <path id="circ" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" />
                </defs>
                <text fontFamily="var(--font-mono), monospace" fontSize="7.4" letterSpacing="2" fill="currentColor">
                  <textPath href="#circ" startOffset="1%">
                    CREDO · UNDERWRITING · HASHKEY CHAIN ·{" "}
                  </textPath>
                </text>
              </svg>
              <div className="core">
                <div className="big">{data.determination.startsWith("Approved") ? "APPROVED" : "REVIEWED"}</div>
                <div className="sub">TIER {data.tier} · ON-CHAIN</div>
              </div>
            </div>
            <div className="score-block">
              <div className="grade-letter">{data.tier}</div>
              <div className="score-figure">
                {data.score}
                <span className="out"> / {data.max}</span>
              </div>
              <div className="score-label">Composite Credit Score</div>
              <div className="meter">
                <div className="scale">
                  <div className="fillm" ref={fillRef} />
                </div>
                <div className="marks">
                  <span>0</span>
                  <span>250</span>
                  <span>500</span>
                  <span>750</span>
                  <span>1000</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rv d4">
            <div className="rationale-head">Underwriter&apos;s Determination</div>
            <p className="rationale">{data.rationale}</p>
          </div>
        </div>

        <div className="div-dash rv d4" />

        <div className="ledger-title rv d5">
          <h2>Schedule of On-Chain Signals</h2>
          <span className="stamp-sum">
            Σ POINTS = {data.score} / {data.max}
          </span>
        </div>
        <div className="ledger-sub rv d5">Each factor independently sourced &amp; verifiable on-chain</div>

        <table className="ledger rv d5">
          <thead>
            <tr>
              <th>№</th>
              <th>Factor</th>
              <th>Reading</th>
              <th className="r wcol">Weight</th>
              <th className="r">Points</th>
            </tr>
          </thead>
          <tbody>
            {data.signals.map((s, i) => (
              <tr key={s.n} className={`rv${s.drag ? " drag" : ""}`} style={{ ["--i" as string]: i } as React.CSSProperties}>
                <td className="num">{s.n}</td>
                <td>
                  <div className="sig-name">
                    {s.name}
                    <small>{s.sub}</small>
                  </div>
                </td>
                <td className="reading">{s.reading}</td>
                <td className="weight">{s.weight}</td>
                <td className="points">
                  <div className="pt-wrap">
                    <div className="pt-bar">
                      <i
                        ref={(el) => {
                          barRefs.current[i] = el;
                        }}
                      />
                    </div>
                    <span className="pt-val">{s.points}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="totlabel">
                Composite Score — sum of weighted factors
              </td>
              <td className="totlabel" style={{ textAlign: "right" }}>
                100%
              </td>
              <td className="tot">{data.score}</td>
            </tr>
          </tfoot>
        </table>

        <div className="div-dash rv d6" />

        <section className="action rv d6" aria-labelledby="offer-amt">
          <div className="action-head">
            <span>{data.determination.startsWith("Approved") ? "Approved Offer — Enforced On-Chain" : "Offered Terms — Enforced On-Chain"}</span>
            <span className="seal">
              <span className="gdot" />
              {data.offer.collateral} collateral · Tier {data.tier}
            </span>
          </div>
          <div className="action-body">
            <div className="offer">
              <div className="offer-eyebrow">Borrow up to</div>
              <div className="offer-amount" id="offer-amt">
                <span className="cur">$</span>
                {data.offer.amount}
              </div>
              <div className="offer-sub">
                {data.determination.startsWith("Approved") ? "Available now, under-collateralized" : "Over-collateralized terms"}
              </div>
              <div className="offer-mini">
                <div className="m">
                  <div className="k">Collateral</div>
                  <div className="v">
                    {data.offer.collateral}{" "}
                    <span style={{ fontSize: ".6em", color: "rgba(247,240,225,.6)" }}>· LTV {data.offer.ltv}</span>
                  </div>
                </div>
                <div className="m">
                  <div className="k">Rate</div>
                  <div className="v">{data.offer.rate}</div>
                </div>
                <div className="m">
                  <div className="k">Term</div>
                  <div className="v">{data.offer.term}</div>
                </div>
              </div>
            </div>
            <div className="cta-stack">{cta}</div>
          </div>
        </section>

        <div className="div-dot rv d7" />

        <p className="trust rv d7">
          The AI advises within bounds — <b>the smart contract enforces every cap.</b> Verifiable on HashKey Chain.
        </p>

        <div className="footer rv d8">
          <span>Enforced on-chain · HashKey Chain</span>
          <span>Credo · Office of On-Chain Creditworthiness</span>
        </div>
      </div>
    </div>
  );
}
