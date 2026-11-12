/** A plan as Delio Admin publishes it at `/api/public/plans`: prices in US dollars, with the CFA francs a payer is charged. */
export interface DelioPlan {
  id: string;
  name: string;
  /** One month, or the whole trial. */
  usd: number;
  /** A year paid at once; null when the plan is not sold by the year. */
  usdYear: number | null;
  francs: number;
  francsYear: number | null;
  /** AI credits each month, or for the whole trial. */
  credits: number;
  /** Cloud computer hours included each month, or for the whole trial. */
  computerHours: number;
  /** Cloud computers awake at once. */
  computers: number;
  /** False for BYOK: the workspace brings its own AI and cloud computer keys. */
  gateway: boolean;
  /** Shown on the public site; the others only inside the app. */
  listed: boolean;
}

export interface DelioTopup { id: string; credits: number; usd: number; francs: number }

/** `GET /api/delio/plans`: the catalog, and the portal address that opens SasPay's checkout for one of its entries. */
export interface DelioCatalog {
  trialDays: number;
  recommended: string;
  plans: DelioPlan[];
  topups: DelioTopup[];
  payUrl: string;
}

/** Where Choose leads: the portal signs the person in if needed, then opens SasPay's checkout for the plan or top-up picked. */
export function delioCheckoutUrl(payUrl: string, pick: Record<string, string>): string {
  const url = new URL(payUrl);
  for (const [key, value] of Object.entries(pick)) url.searchParams.set(key, value);
  return url.href;
}

const ID = /^[a-z][a-z0-9-]{0,23}$/;
const amount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10_000_000;
const whole = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000_000;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
// oxlint-disable-next-line no-control-regex
const label = (value: unknown) => typeof value === "string" && value.trim() && value.length <= 40 && !/[\x00-\x1f\x7f<>]/.test(value) ? value.trim() : null;

function plan(input: unknown): DelioPlan | null {
  if (!record(input) || typeof input.id !== "string" || !ID.test(input.id)) return null;
  const name = label(input.name);
  const yearly = input.usdYear === null || amount(input.usdYear);
  if (!name || !amount(input.usd) || !yearly || !whole(input.francs) || !(input.francsYear === null || whole(input.francsYear))) return null;
  if (!whole(input.credits) || !amount(input.computerHours) || !whole(input.computers)) return null;
  return {
    id: input.id, name, usd: input.usd, usdYear: input.usdYear as number | null, francs: input.francs, francsYear: input.francsYear as number | null,
    credits: input.credits, computerHours: input.computerHours, computers: input.computers, gateway: input.gateway === true, listed: input.listed === true,
  };
}

function topup(input: unknown): DelioTopup | null {
  if (!record(input) || typeof input.id !== "string" || !ID.test(input.id)) return null;
  return whole(input.credits) && amount(input.usd) && whole(input.francs) ? { id: input.id, credits: input.credits, usd: input.usd, francs: input.francs } : null;
}

/** The portal's catalog as the apps trust it: unknown or malformed entries are dropped, and nothing is left without a plan. */
export function parseDelioCatalog(input: unknown, payUrl: string): DelioCatalog | null {
  if (!record(input)) return null;
  const plans = (Array.isArray(input.plans) ? input.plans.slice(0, 12) : []).map(plan).filter((item): item is DelioPlan => item !== null);
  if (!plans.length) return null;
  const topups = (Array.isArray(input.topups) ? input.topups.slice(0, 6) : []).map(topup).filter((item): item is DelioTopup => item !== null);
  const recommended = typeof input.recommended === "string" && plans.some((item) => item.id === input.recommended) ? input.recommended : plans[0]!.id;
  const trialDays = whole(input.trialDays) && input.trialDays >= 1 && input.trialDays <= 30 ? input.trialDays : 3;
  return { trialDays, recommended, plans, topups, payUrl };
}
