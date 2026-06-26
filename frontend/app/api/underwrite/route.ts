import { isAddress } from "viem";
import { underwrite } from "@/lib/server/underwrite";

// Needs Node APIs (viem signing, process.env secrets) — never the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/underwrite { address, chainId? } -> score + Gemini rationale + signed EIP-712 attestation. */
export async function POST(request: Request) {
  let body: { address?: unknown; chainId?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { address, chainId } = body;
  if (typeof address !== "string" || !isAddress(address)) {
    return Response.json({ error: "valid `address` required" }, { status: 400 });
  }

  try {
    const result = await underwrite(address, chainId != null ? Number(chainId) : undefined);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
