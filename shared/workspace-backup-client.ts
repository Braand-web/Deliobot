// Exact app-owned browser state that belongs in an encrypted full backup.
// Never include cookies, authentication tokens, connection caches or unknown keys.
export const WORKSPACE_BACKUP_CLIENT_KEYS = [
  "odb-drafts",
  "odb-draft-attachments",
  "odb-draft-send-ids",
  "odb-draft-channel-modes",
  "odb-skin",
  "odb-show-threads",
  "odb-show-run-card",
  "odb-send-key",
  "odb-color-user-bubbles",
  "odb-chat-width",
  "opendeliobot.sidebarDensity",
  "opendeliobot.sidebarToolsLayout",
  "opendeliobot.sidebarCollapsedSections.v1",
  "opendeliobot.sidebarSectionOrder.v1",
  "odb-analytics-opt-out",
  "opendeliobot.remote-voice.v1",
] as const;

export type WorkspaceBackupClientState = Partial<Record<(typeof WORKSPACE_BACKUP_CLIENT_KEYS)[number], string>>;
