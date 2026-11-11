export interface MailMessage { to: string; subject: string; text: string }
export interface Mailer { send(message: MailMessage): Promise<void> }

/** Development only: prints messages, codes included, to the console instead of sending them. */
export const consoleMailer: Mailer = {
  async send(message) {
    console.log(`delio-admin mail to ${message.to}: ${message.subject}\n${message.text}\n`);
  },
};

/**
 * Sends through any HTTPS mail API that accepts `{from, to, subject, text}` JSON with a bearer key
 * (Resend's POST /emails takes exactly this shape).
 */
export function httpMailer(options: { endpoint: string; apiKey: string; from: string; fetchImpl?: typeof fetch }): Mailer {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async send(message) {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ from: options.from, to: message.to, subject: message.subject, text: message.text }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`mail provider answered ${response.status}`);
    },
  };
}
