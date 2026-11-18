export const APP_NAME = "OpenDeliobot";
export const APP_REPOSITORY = "https://github.com/Braand-web/Deliobot";
export const DOCS_URL = `${APP_REPOSITORY}/tree/main/docs`;
export const SUPPORT_EMAIL = "support@deliobot.fun";
export const HELP_CENTER_URL = "https://deliobot.fun/guides";
export const APPROVAL_LEVELS_URL = `${APP_REPOSITORY}/blob/main/docs/approval-levels.md`;
export const PASSKEY_HELP_URL = HELP_CENTER_URL;
export const FEEDBACK_URL = `mailto:${SUPPORT_EMAIL}`;
export const RELEASES_URL = `${APP_REPOSITORY}/releases`;
export const PRICING_URL = "https://deliobot.fun/#tarifs";
export const TEAM_PLANS_URL = PRICING_URL;
export const CLOUD_PLAN_URL = "https://compte.deliobot.fun/";
/** The account portal's team People page: `invite` opens its invite box, `seats` its seat stepper. */
export const TEAM_PEOPLE_PAGES = { invite: "people?do=invite", seats: "people?do=seats" } as const;
/** `cloudPage`: the portal's pages for this team, sent by the server. */
export function teamPeoplePage(team: { id: string; cloudPage?: string } | null | undefined, open: keyof typeof TEAM_PEOPLE_PAGES = "invite"): string | null {
  return team?.cloudPage ? `${team.cloudPage}/team/${encodeURIComponent(team.id)}/${TEAM_PEOPLE_PAGES[open]}` : null;
}
export function withSource(url: string, source: string): string {
  const target = new URL(url);
  target.searchParams.set("src", source);
  return target.href;
}
export const LICENSE_URL = `${APP_REPOSITORY}/blob/main/LICENSE`;
/** Deliobot's own phone apps; null until they are published, and the app says they are coming soon. */
export const IOS_APP_STORE_URL: string | null = null;
export const ANDROID_APK_URL: string | null = null;

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

export function desktopAppVersion(): string {
  return (typeof window !== "undefined" && window.odb?.app?.version) || appVersion();
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export function platformLabel(platform?: string): string | null {
  return (platform && PLATFORM_NAMES[platform]) ?? null;
}

export async function openExternalLink(url: string): Promise<void> {
  if (window.odb?.openExternal) {
    await window.odb.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** A browser hands a mailto: link to its own mail app; the desktop app's window may not navigate to one, so main opens it. */
export async function openEmailDraft(url: string): Promise<void> {
  if (window.odb) return openExternalLink(url);
  window.location.href = url;
}
