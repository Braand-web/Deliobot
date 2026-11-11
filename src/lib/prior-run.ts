// Read before main.tsx's first-paint writes: applySkin stamps odb-skin on every boot.
const PRIOR_RUN_KEYS = ["odb-skin", "odb-installed", "odb-email-gate", "odb-drafts", "odb-show-threads"];

export function hasPriorRun(store: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return PRIOR_RUN_KEYS.some((key) => store?.getItem(key) != null);
  } catch {
    return false;
  }
}
