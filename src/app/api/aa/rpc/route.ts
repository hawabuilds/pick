import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { RH_TESTNET_ID } from "@/config/chain";
import { CLAIM_DISTRIBUTOR_ADDRESS } from "@/config/contracts";
import { allow, clientFingerprint, LIMITS, logAbuse } from "@/lib/server/limits";
import { isResponse, requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bundler and gas-manager proxy.
 *
 * Everything account-abstraction-related goes through here rather than straight
 * to Alchemy, for two reasons. The Alchemy key and the gas policy id stay on the
 * server, and every sponsorship request passes a rate limit first — a paymaster
 * endpoint open to the internet is a paymaster balance someone else spends.
 *
 * Sponsorship is additionally pinned to our own contracts: an operation that
 * calls anything else is refused, so the policy cannot be used to fund
 * arbitrary transactions.
 */

const BUNDLER_URL = process.env.ALCHEMY_TESTNET_RPC_URL ?? "";
const GAS_POLICY_ID = process.env.ALCHEMY_GAS_POLICY_ID ?? "";

/** Everything the client legitimately needs, and nothing else. */
const READ_METHODS = new Set([
  "eth_chainId",
  "eth_getCode",
  "eth_call",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationByHash",
  "eth_getUserOperationReceipt",
  "eth_supportedEntryPoints",
  "eth_maxPriorityFeePerGas",
  "eth_gasPrice",
  "eth_getBlockByNumber",
  "rundler_maxPriorityFeePerGas",
]);

const SPONSOR_METHODS = new Set([
  "pm_getPaymasterStubData",
  "pm_getPaymasterData",
]);

const SEND_METHODS = new Set(["eth_sendUserOperation"]);

const requestSchema = z.object({
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.array(z.unknown()).optional(),
});

function rpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

/**
 * The contract a sponsored operation is allowed to call.
 *
 * SimpleAccount's calldata is `execute(dest, value, func)`, so the destination
 * is the first argument: bytes 16-36 of the first ABI word after the selector.
 */
function sponsoredTarget(callData: string): string | null {
  if (typeof callData !== "string" || !callData.startsWith("0x")) return null;
  const body = callData.slice(10);
  if (body.length < 64) return null;
  return `0x${body.slice(24, 64)}`.toLowerCase();
}

function targetAllowed(params: unknown[]): boolean {
  const distributor = CLAIM_DISTRIBUTOR_ADDRESS?.toLowerCase();
  if (!distributor) return false;

  const userOp = params[0] as { callData?: string } | undefined;
  const target = sponsoredTarget(userOp?.callData ?? "");
  return target === distributor;
}

export async function POST(request: NextRequest) {
  if (!BUNDLER_URL || !GAS_POLICY_ID) {
    return rpcError(null, -32601, "Gas sponsorship is not configured.");
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return rpcError(null, -32600, "Invalid request.");
  }

  const { id, method } = parsed.data;
  const params = parsed.data.params ?? [];

  const sponsoring = SPONSOR_METHODS.has(method);
  const sending = SEND_METHODS.has(method);

  if (!sponsoring && !sending && !READ_METHODS.has(method)) {
    return rpcError(id, -32601, `Method ${method} is not available here.`);
  }

  // Reads are open to any signed-in player; anything that spends the paymaster
  // needs an account we can attribute it to.
  const auth = await requireUser(request);
  if (isResponse(auth)) {
    if (sponsoring || sending) return auth;
  }

  const subject = isResponse(auth) ? clientFingerprint(request) : auth.userId;

  if (sponsoring || sending) {
    if (!targetAllowed(params)) {
      await logAbuse({
        kind: "aa_target_refused",
        userId: isResponse(auth) ? null : auth.userId,
        detail: { method },
        request,
      });
      return rpcError(
        id,
        -32602,
        "Only claims can be sponsored.",
      );
    }
  }

  const limit = sponsoring ? LIMITS.paymasterSponsor : LIMITS.bundlerRead;
  if (!(await allow(limit, subject))) {
    return rpcError(id, -32005, "Too many requests. Try again shortly.");
  }

  // The policy id is injected here so it never reaches the browser. ERC-7677
  // puts it in the context, which is the last parameter of both pm_ methods.
  const forwarded = sponsoring
    ? [params[0], params[1], params[2] ?? RH_TESTNET_ID, { policyId: GAS_POLICY_ID }]
    : params;

  try {
    const upstream = await fetch(BUNDLER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: id ?? 1, method, params: forwarded }),
      cache: "no-store",
    });

    const result = await upstream.json();
    return NextResponse.json(result, { status: upstream.ok ? 200 : upstream.status });
  } catch {
    return rpcError(id, -32603, "The bundler is unreachable.");
  }
}
