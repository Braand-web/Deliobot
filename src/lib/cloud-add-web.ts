import type { CloudSource } from "@/lib/cloud-plan";

export type CloudAddRequest = { source: CloudSource; signIn?: true };

/** The desktop's own Delio Cloud sign-in, which Add a Cloud runs on: none in a browser or on a desktop showing another computer. */
export function cloudAccountBridge() {
  return window.odb?.remoteClient?.active ? undefined : window.odb?.cloudAccount;
}
