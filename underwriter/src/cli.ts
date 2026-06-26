import { underwrite } from "./underwrite.js";

/** Usage: pnpm score <0xAddress> [chainId] */
async function main() {
  const address = process.argv[2];
  const chainId = process.argv[3] ? Number(process.argv[3]) : undefined;
  if (!address) {
    console.error("Usage: pnpm score <0xAddress> [chainId]");
    process.exit(1);
  }

  const r = await underwrite(address, chainId);

  console.log(`\n=== Credo underwriting — ${r.address} (chain ${r.chainId}) ===\n`);
  console.log(`Score:  ${r.score.score}/1000   Tier ${r.score.tier}   ${r.score.approved ? "APPROVED (under-collateralized)" : "OVER-COLLATERALIZED ONLY"}`);
  console.log(`Terms:  maxLTV ${r.score.maxLtvBps / 100}%  (${r.score.collateralRatioPct}% collateral)  ` +
    `rate ${(r.score.interestRateBps / 100).toFixed(1)}% APR  max $${r.score.maxPrincipalUsd.toLocaleString("en-US")}\n`);

  console.log("Signal breakdown:");
  for (const f of r.score.features) {
    console.log(`  ${f.label.padEnd(28)} ${String(f.raw).padStart(12)}  →  ${f.points} pts (w=${f.weight})`);
  }

  console.log(`\nRationale (${r.rationale.source}):\n${r.rationale.text}\n`);

  if (r.attestation) {
    console.log("Signed attestation:");
    console.log(JSON.stringify(r.attestation, null, 2));
  }
  if (r.warnings.length) {
    console.log("\nWarnings:");
    for (const w of r.warnings) console.log(`  - ${w}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
