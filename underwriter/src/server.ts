import express from "express";
import cors from "cors";
import { isAddress } from "viem";
import { loadConfig } from "./config.js";
import { underwrite } from "./underwrite.js";

const cfg = loadConfig();
const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    chainId: cfg.chainId,
    underwriterConfigured: Boolean(cfg.underwriterPrivateKey),
    llmConfigured: Boolean(cfg.anthropicApiKey),
    llmModel: cfg.llmModel,
  });
});

/** POST /underwrite { address, chainId? } -> score + rationale + signed attestation. */
app.post("/underwrite", async (req, res) => {
  const { address, chainId } = req.body ?? {};
  if (typeof address !== "string" || !isAddress(address)) {
    res.status(400).json({ error: "valid `address` required" });
    return;
  }
  try {
    const result = await underwrite(address, chainId ? Number(chainId) : undefined, cfg);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.listen(cfg.port, () => {
  console.log(`Credo underwriter listening on :${cfg.port} (chain ${cfg.chainId})`);
  if (!cfg.underwriterPrivateKey) console.warn("⚠ UNDERWRITER_PRIVATE_KEY unset — quotes will be unsigned.");
  if (!cfg.anthropicApiKey) console.warn("⚠ ANTHROPIC_API_KEY unset — rationale uses the offline template.");
});
