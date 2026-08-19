import { verifyAccessToken } from "@privy-io/node";
import { createRemoteJWKSet, importSPKI } from "jose";
import type { NextRequest } from "next/server";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const configuredKey = (process.env.PRIVY_VERIFICATION_KEY ?? "").trim();

export const hasPrivyServerAuth = appId.length > 0;

type VerificationKey = Awaited<ReturnType<typeof importSPKI>> | ReturnType<typeof createRemoteJWKSet>;

let verificationKey: VerificationKey | null = null;

/**
 * Only a PEM block is a verification key. Anything else — most easily the JWKS
 * URL, which looks like it belongs here — would throw inside importSPKI, and
 * that throw is caught below as "this token is invalid", silently refusing every
 * signed-in request in the app. So the shape is checked rather than assumed.
 */
function isSpkiPem(value: string): boolean {
  return value.startsWith("-----BEGIN PUBLIC KEY-----");
}

if (configuredKey && !isSpkiPem(configuredKey)) {
  console.warn(
    "PRIVY_VERIFICATION_KEY is not an SPKI public key block, so it is being " +
      "ignored and tokens will be verified against Privy's JWKS endpoint " +
      "instead. Set it to the PEM from the Privy dashboard, or leave it unset.",
  );
}

async function getVerificationKey(): Promise<VerificationKey> {
  if (verificationKey) return verificationKey;
  verificationKey = isSpkiPem(configuredKey)
    ? await importSPKI(configuredKey, "ES256")
    : createRemoteJWKSet(
        new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`),
      );
  return verificationKey;
}

/**
 * Returns the Privy DID of the caller, or null when the request is unauthenticated.
 * When Privy is not configured the app is in local demo mode and there is no
 * server-side identity to establish.
 */
export async function getPrivyId(request: NextRequest): Promise<string | null> {
  if (!hasPrivyServerAuth) return null;

  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  try {
    const claims = await verifyAccessToken({
      access_token: token,
      app_id: appId,
      verification_key: await getVerificationKey(),
    });
    return claims.user_id;
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

/**
 * An expired token is routine and not worth a line in the log every time. A
 * misconfigured key fails identically but on every request forever, and used to
 * do so in complete silence, so the first failure is reported.
 */
let warned = false;

function warnOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(
    "Privy token verification failed. If this repeats for every request, the " +
      "app id or verification key is wrong rather than the token:",
    error instanceof Error ? error.message : error,
  );
}
