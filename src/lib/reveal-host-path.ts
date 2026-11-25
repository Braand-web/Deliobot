import { t } from "@/lib/i18n";

/** An absolute host path the desktop's Show in folder can open. */
export const REVEALABLE_PATH = /^(?:\/(?!\/)|[a-zA-Z]:[\\/])/;

export function canRevealHostPath(filePath: string): boolean {
  return REVEALABLE_PATH.test(filePath);
}

/** The desktop's Show in folder; absent in a browser and for a remote client. */
export function revealBridge(): NonNullable<Window["odb"]>["revealInFolder"] {
  const odb = typeof window === "undefined" ? undefined : window.odb;
  return odb?.remoteClient?.active ? undefined : odb?.revealInFolder;
}

export type RevealHostPathResult = "shown" | "missing" | "failed" | "unavailable";

export async function revealHostPath(filePath: string): Promise<RevealHostPathResult> {
  const reveal = revealBridge();
  if (!reveal || !REVEALABLE_PATH.test(filePath)) return "unavailable";
  try {
    const result = await reveal(filePath);
    if (result === "missing") return "missing";
    if (result !== "shown") return "failed";
    return "shown";
  } catch {
    return "failed";
  }
}

export function revealProblemText(result: RevealHostPathResult): string {
  if (result === "missing") return t("attach.revealMissing");
  if (result === "failed") return t("attach.revealFailed");
  return "";
}
