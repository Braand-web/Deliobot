// Proof that a workspace owns the e-mail domain it wants to sign in with single sign-on: a TXT record at
// _deliobot.<domain> holding deliobot-verify=<token>, read over DNS-over-HTTPS.
export const SSO_TXT_PREFIX = "deliobot-verify=";
export const ssoTxtName = (domain: string) => `_deliobot.${domain}`;

export async function domainHoldsToken(domain: string, token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  const url = `https://cloudflare-dns.com/dns-query?${new URLSearchParams({ name: ssoTxtName(domain), type: "TXT" })}`;
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/dns-json" }, redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return false;
    const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
    return (body.Answer ?? []).some((answer) => answer.type === 16 && typeof answer.data === "string" && answer.data.replace(/"\s*"/g, "").replace(/"/g, "").trim() === `${SSO_TXT_PREFIX}${token}`);
  } catch {
    return false;
  }
}
