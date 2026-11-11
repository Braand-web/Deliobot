import { createHash, createPublicKey, verify, type JsonWebKeyInput } from "node:crypto";

export interface OidcProvider { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
export interface IdentityClaims { email: string; subject: string }

type Fetch = typeof fetch;
const DEADLINE_MS = 5_000;
const CLOCK_SKEW_S = 60;
/** RS256 and ES256 are the algorithms OpenID Connect providers (Google, Microsoft Entra, Okta, Auth0) sign ID tokens with. */
const ALGORITHMS: Record<string, { hash: string; dsaEncoding?: "ieee-p1363" }> = {
  RS256: { hash: "sha256" },
  ES256: { hash: "sha256", dsaEncoding: "ieee-p1363" },
};

async function getJson(fetchImpl: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(DEADLINE_MS) });
  if (!response.ok) throw new Error(`identity provider answered ${response.status}`);
  return response.json();
}

function httpsUrl(value: unknown, allowHttp: boolean): string {
  if (typeof value !== "string") throw new Error("identity provider metadata is incomplete");
  const url = new URL(value);
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) throw new Error("identity provider endpoints must use HTTPS");
  return url.href;
}

export async function discover(fetchImpl: Fetch, issuer: string, allowHttp = false): Promise<OidcProvider> {
  const body = await getJson(fetchImpl, `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`) as Record<string, unknown>;
  // OpenID Connect Discovery 1.0 §4.3: the advertised issuer must equal the one that was configured.
  if (body.issuer !== issuer) throw new Error("identity provider issuer does not match");
  return {
    issuer,
    authorization_endpoint: httpsUrl(body.authorization_endpoint, allowHttp),
    token_endpoint: httpsUrl(body.token_endpoint, allowHttp),
    jwks_uri: httpsUrl(body.jwks_uri, allowHttp),
  };
}

export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export async function exchangeCode(fetchImpl: Fetch, provider: OidcProvider, input: { code: string; verifier: string; redirectUri: string; clientId: string; clientSecret: string }): Promise<string> {
  const body = await getJson(fetchImpl, provider.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri, code_verifier: input.verifier,
      client_id: input.clientId, client_secret: input.clientSecret }).toString(),
  }) as Record<string, unknown>;
  if (typeof body.id_token !== "string") throw new Error("identity provider returned no ID token");
  return body.id_token;
}

function decodePart(part: string | undefined): Record<string, unknown> {
  if (!part) throw new Error("malformed ID token");
  const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("malformed ID token");
  return value as Record<string, unknown>;
}

export async function verifyIdToken(fetchImpl: Fetch, provider: OidcProvider, idToken: string, expected: { clientId: string; nonce: string; now: number }): Promise<IdentityClaims> {
  const [head, payload, signature] = idToken.split(".");
  const header = decodePart(head);
  const algorithm = typeof header.alg === "string" ? ALGORITHMS[header.alg] : undefined;
  if (!algorithm || signature === undefined) throw new Error("unsupported ID token algorithm");
  const jwks = await getJson(fetchImpl, provider.jwks_uri) as { keys?: Array<JsonWebKeyInput["key"] & { kid?: string; alg?: string; use?: string }> };
  const candidates = (jwks.keys ?? []).filter((key) => (header.kid === undefined || key.kid === header.kid) && (key.alg === undefined || key.alg === header.alg) && key.use !== "enc");
  const signed = Buffer.from(`${head}.${payload}`);
  const raw = Buffer.from(signature, "base64url");
  const valid = candidates.some((jwk) => {
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" });
      return verify(algorithm.hash, signed, algorithm.dsaEncoding ? { key, dsaEncoding: algorithm.dsaEncoding } : key, raw);
    } catch { return false; }
  });
  if (!valid) throw new Error("ID token signature is invalid");

  const claims = decodePart(payload);
  const seconds = Math.floor(expected.now / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== provider.issuer) throw new Error("ID token issuer does not match");
  if (!audience.includes(expected.clientId)) throw new Error("ID token audience does not match");
  if (audience.length > 1 && claims.azp !== expected.clientId) throw new Error("ID token authorized party does not match");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < seconds) throw new Error("ID token has expired");
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_S > seconds) throw new Error("ID token was issued in the future");
  if (claims.nonce !== expected.nonce) throw new Error("ID token nonce does not match");
  if (typeof claims.email !== "string" || claims.email_verified !== true) throw new Error("the identity provider did not vouch for an email address");
  if (typeof claims.sub !== "string") throw new Error("ID token has no subject");
  return { email: claims.email.trim().toLowerCase(), subject: claims.sub };
}
