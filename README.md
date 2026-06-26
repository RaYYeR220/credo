# Credo — AI Credit Underwriting for Under‑Collateralized Lending on HashKey Chain

> An on‑chain lending protocol where an **AI underwriter** scores a borrower from verifiable on‑chain
> history, prices an **under‑collateralized** loan, and a smart contract issues it **within hard,
> on‑chain‑enforced risk limits**. The AI advises; the contract decides.

Built for the **HSK Chain "On‑Chain Horizon" Hackathon (Japan)** — AI track. **Live on HashKey Chain mainnet.**

---

## The thesis

DeFi lending today is **over‑collateralized**: deposit \$150 to borrow \$100. It is capital‑inefficient
and excludes anyone without existing capital. Real‑world credit runs on **underwriting** — assessing a
borrower instead of demanding excess collateral. Credo puts that underwriting on‑chain, unlocking the
under‑collateralized lending that over‑collateralized DeFi can't — exactly HashKey's "technology
empowers finance, new financial infrastructure" thesis.

**Why it isn't "an LLM said creditworthy":**
- The load‑bearing score is a **deterministic, transparent, auditable** weighted model over on‑chain
  signals — every point is attributable to a factor (shown in the UI's score breakdown).
- The LLM (Claude) only writes the **human‑readable rationale**; it never moves the number.
- The AI's authority is **bounded on‑chain**: `CreditManager` re‑checks every cap, so a wrong, stale,
  or even compromised underwriter signature can never push the protocol past its limits.

---

## How it works

```
 Borrower            AI Underwriter (off-chain)                 HashKey Chain (on-chain)
 ────────            ──────────────────────────                 ────────────────────────
   wallet  ──────▶   1. read cross-chain signals  ──────────▶   ReputationRegistry (history)
                        (Ethereum history + Credo reputation)
                     2. deterministic score → tier
                        → max LTV / rate / term / principal
                     3. Claude writes the rationale
                     4. sign EIP-712 LoanTerms  ──────────────▶  CreditManager.borrow():
                        (the "attestation")                        • verify signature == underwriter
                                                                    • enforce HARD CAPS (below)
                                                                    • pull collateral, disburse from
   receives loan  ◀────────────────────────────────────────────     LendingPool, record reputation
```

### Bounded‑AI safety gates (enforced in `CreditManager`)
Even a validly‑signed attestation is rejected unless it sits inside the protocol's hard limits:
**per‑loan cap**, **protocol max‑LTV ceiling**, **max interest rate**, **max term** (no
never‑liquidatable loans), a **realized‑LTV check** against the collateral actually posted, and
**EIP‑712 + nonce + expiry** replay protection. The `LendingPool` additionally caps exposure
(`maxUtilizationBps`). *Remove the AI and you're back to over‑collateralized DeFi — it's load‑bearing.*

### Reputation flywheel
Repayments and defaults update the borrower's on‑chain reputation (`ReputationRegistry`), which feeds
future scores — an on‑chain credit bureau that improves with honest use.

### The deterministic score (transparent, off‑chain)
Six weighted on‑chain signals → 0–1000 → risk tier → loan terms:

| Signal | Weight | Reads |
|---|---|---|
| Wallet age | 18% | first‑tx age (cross‑chain) |
| Transaction activity | 14% | tx count |
| Holdings (skin in the game) | 20% | USD value of holdings |
| DeFi sophistication | 10% | distinct protocols used |
| Prior liquidations | 18% | liquidation events (negative) |
| Credo repayment history | 20% | the on‑chain flywheel |

Tiers A/B/C unlock **under‑collateralized** credit; D/E fall back to **over‑collateralized** terms —
the safety gate, on‑chain.

---

## Live on HashKey Chain MAINNET (chain 177)

RPC `https://mainnet.hsk.xyz` · explorer https://hashkey.blockscout.com

| Contract | Address |
|---|---|
| CreditManager | `0x793181d83B9648Ba8A4520E8256D37754FdFadc8` |
| LendingPool | `0x4f2A080Cf4bEb800205BA48F532293A55805f73c` |
| ReputationRegistry | `0x8B748073483920B02c2421943f6a7304cb620eBe` |
| MockPriceOracle | `0x9B38a447FB9cb6B269C65e978f64F5bb20D52f42` |
| mUSD (loan asset) | `0x154B7BD77477e4C2CE41038109faBdf66BBa25Da` |
| mETH (collateral) | `0xb3E4b67E9D1E2F106A49caEaDe778e3511535789` |

**Verifiable mainnet loan** (deploy → AI underwrite → EIP‑712 attestation → on‑chain borrow):
[`0x172e06b0…99c6e`](https://hashkey.blockscout.com/tx/0x172e06b04f826c9bd4d0388b6bf418f3bab66d3b8ee36d808d5e512496999c6e)

Also deployed on **testnet (chain 133)** — CreditManager `0x0F61C9021B9c9a9bAFe7d2a3792bCCE6e0C78c30`.

---

## Repository layout

| Path | What |
|---|---|
| `contracts/` | Foundry — Solidity contracts + tests (30 passing) + deploy script |
| `underwriter/` | TypeScript AI underwriter — signals → deterministic score → Claude rationale → EIP‑712 signature; HTTP API + CLI |
| `frontend/` | Next.js app — borrower "Statement of Credit Assessment", lender, dashboard |

| Contract | Role |
|---|---|
| `CreditManager` | Verifies the AI's EIP‑712 attestation, enforces every hard cap, issues / repays / liquidates loans |
| `LendingPool` | ERC‑4626 lender pool; interest accrues to share price, defaults socialised, exposure‑capped |
| `ReputationRegistry` | On‑chain credit bureau — per‑borrower history + transparent derived score |
| `MockPriceOracle`, `MockERC20` | Demo fixtures (USD‑priced oracle, mintable mUSD / mETH) |

---

## Run locally

**Prereqs:** Foundry, Node 20+, pnpm.

```bash
# 1. Contracts — test + deploy
cd contracts
forge test                                   # 30 passing
cp .env.example .env                          # set PRIVATE_KEY (funded), UNDERWRITER_ADDRESS
forge script script/Deploy.s.sol --rpc-url hsk_mainnet --broadcast   # writes deployments/<chainId>.json

# 2. AI underwriter service
cd ../underwriter && pnpm install
cp .env.example .env                          # UNDERWRITER_PRIVATE_KEY, ETHERSCAN_API_KEY, ANTHROPIC_API_KEY (optional)
pnpm test                                     # scoring-engine tests
pnpm start                                    # HTTP API on :8791

# 3. Frontend
cd ../frontend && pnpm install
cp .env.example .env.local
pnpm dev                                      # http://localhost:3005
```

End‑to‑end from the CLI (no browser): `cd underwriter && npx tsx src/demo.ts 1000 1 177`
(underwrite → sign → borrow on mainnet), then `npx tsx src/repay.ts` (repay → reputation flywheel).

---

## Demo walkthrough

1. **Lender** funds the pool (`/lend`) — deposits mUSD, earns interest as borrowers repay.
2. **Strong borrower** connects a wallet with real on‑chain history → *Assess my wallet* → a high score
   and an **under‑collateralized** offer (collateral < loan) → *Take loan* → issued on‑chain.
3. **Thin wallet** → low score → the protocol offers **only over‑collateralized** terms — the safety
   gate, live.
4. **Repay** (`/dashboard`) → reputation improves → future terms get better (the flywheel).

---

## Security

Two independent adversarial reviews (security + economic/correctness) were run before mainnet. Fixed
in this codebase: **LTV precision** (no premature‑division truncation that could bypass the collateral
check), **bounded term** (`maxTermSeconds`), **ERC‑4626 inflation‑attack offset**, **zero‑address
guards**, **reentrancy guards** + `SafeERC20`, **EIP‑712 replay protection** (nonce + expiry + domain).

Documented production hardening (out of hackathon scope): swap `MockPriceOracle` for a Chainlink/Pyth
feed with a **staleness / sequencer‑uptime check**; put admin setters behind a **timelock + multisig**;
add a **liquidation bounty** and auction seized collateral back into the pool.

---

## How it maps to the judging criteria

- **Completeness** — a full loop, live on mainnet: lender pool → AI underwrite → EIP‑712 → on‑chain
  borrow → repay → reputation → default/liquidation, with a verifiable mainnet tx and a working UI.
- **Technical maturity** — 30 tests, two adversarial audits + fixes, bounded‑AI design, ERC‑4626
  accounting, deterministic auditable scoring.
- **Innovation** — AI underwriting unlocking under‑collateralized lending, with the model's authority
  provably bounded on‑chain — new financial infrastructure, done responsibly.

## Stack
Solidity 0.8.28 · Foundry · OpenZeppelin · viem · TypeScript · Anthropic SDK (Claude) · Express ·
Next.js 16 · React 19 · Tailwind v4 · wagmi.
