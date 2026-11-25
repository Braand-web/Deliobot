import { useEffect, useMemo, useState } from "react";
import { appVersion } from "@/lib/app-links";
import { pageIsThisComputer } from "@/lib/companion-bridge";
import { savedStepsHere, skillsLibraryEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
export { useSettingsPlace, type PlaceKind, type SettingsPlace } from "./settings-place";
import { useAdvancedMode } from "@/lib/interface-mode";
import { railShown, usePlaces, type RailPlace } from "@/lib/places";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useStorageReport } from "@/lib/use-storage-report";
import { useStoreSelector } from "@/state/store-select";
import { workspacesAvailable } from "../WorkspacesSection";
import type { SettingsContext } from "./settings-index";

export function useSettingsContext(): SettingsContext {
  const config = useStoreSelector((state) => state.config);
  const advanced = useAdvancedMode();
  const admin = useOwnerOrAdmin() === true;
  const places = usePlaces();
  const known = useKnownPlaceCount();
  const odb = typeof window === "undefined" ? undefined : window.odb;
  const client = odb?.remoteClient?.active === true;
  const cloud = config?.cloudHome === true;
  const team = Boolean(config?.team);
  const desktop = Boolean(odb);
  const here = pageIsThisComputer();
  const home = here || Boolean(odb?.home);
  const placesShown = known > 1 || (!odb?.environments && railShown(places));
  const plan = desktop ? Boolean(odb?.cloudAccount || (odb?.cloudPlan && cloud)) : cloud && !team && admin;
  const organization = Boolean(odb?.organization) && !client;
  const environments = Boolean(odb?.environments);
  const installations = workspacesAvailable(config);
  const skills = skillsLibraryEnabled(config), savedSteps = savedStepsHere(config);
  const storage = useStorageReport({ enabled: admin && !client }).status === "ready";
  return useMemo(() => ({ desktop, here, home, cloud, team, client, admin, places: placesShown, plan, organization, environments, installations, skills, advanced, storage, savedSteps }),
    [desktop, here, home, cloud, team, client, admin, placesShown, plan, organization, environments, installations, skills, advanced, storage, savedSteps]);
}

/** How many places this app knows (a hidden rail's included), from main's environments list. */
function useKnownPlaceCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const environments = window.odb?.remoteClient?.active ? undefined : window.odb?.environments;
    if (!environments) return;
    let alive = true;
    void environments.state().then((next) => { if (alive) setCount(next?.environments?.length ?? 0); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return count;
}

export interface OtherPlace {
  key: string;
  name: string;
  kind: RailPlace["kind"];
  color: string | null;
  open: () => void;
}

/** The person's other places, in rail order: from the rail where this page has it, else from this computer's list of
 * environments (the window's own rail keeps its list to itself). */
export function useOtherPlaces(page?: string): OtherPlace[] {
  const { places } = usePlaces();
  const [listed, setListed] = useState<OtherPlace[]>([]);
  const environments = typeof window === "undefined" || window.odb?.remoteClient?.active ? undefined : window.odb?.environments;
  useEffect(() => {
    if (!environments || places.length > 0) return;
    let alive = true;
    void environments.state().then((state) => {
      if (!alive || !state) return;
      setListed(state.environments.filter((entry) => entry.id !== state.activeId).map((entry) => ({
        key: entry.id,
        name: entry.kind === "local" && !entry.dataDir ? t("rail.thisComputer") : entry.name,
        kind: entry.kind !== "remote" ? "computer" as const : entry.home || entry.cloud ? "cloud" as const : "server" as const,
        color: entry.color ?? null,
        open: () => void environments.switch(entry.id),
      })));
    }).catch(() => {});
    return () => { alive = false; };
  }, [environments, places.length]);
  const open = typeof window === "undefined" ? undefined : window.odb?.workspaces?.open;
  if (places.length > 0) {
    return places.filter((place) => !place.active).map((place) => ({
      key: place.id, name: place.name, kind: place.kind, color: place.color ?? null, open: () => void open?.(place.id),
    }));
  }
  // A Cloud's page in the desktop window can't read the rail's list, but This computer is always on it.
  const openComputer = typeof window === "undefined" || window.odb?.remoteClient?.active ? undefined : window.odb?.rail?.openComputer;
  if (listed.length === 0 && openComputer && !pageIsThisComputer()) {
    return [{ key: "computer", name: t("rail.thisComputer"), kind: "computer", color: null, open: () => void openComputer(page).catch(() => {}) }];
  }
  return listed;
}

export const versionLine = (version = appVersion()): string => t("settings.overview.version", { version });
