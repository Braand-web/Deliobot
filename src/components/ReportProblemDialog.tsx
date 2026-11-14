import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";

import { t } from "@/lib/i18n";
import { closeProblemReport, useProblemReportDraft } from "@/lib/report-problem";
import { api, ApiError } from "@/state/api";
import { ConfirmDialog } from "./ConfirmDialog";

type Phase = "writing" | "sending" | "sent" | "not-connected" | "too-many" | "failed";

const RESULT: Record<Exclude<Phase, "writing" | "sending">, Parameters<typeof t>[0]> = {
  sent: "report.sent", "not-connected": "report.notConnected", "too-many": "report.tooMany", failed: "report.failed",
};

/** Asks before anything leaves the computer: what will be sent, a note, and whether the conversation goes with it. */
export function ReportProblemDialog() {
  const draft = useProblemReportDraft();
  const [note, setNote] = useState("");
  const [withConversation, setWithConversation] = useState(true);
  const [phase, setPhase] = useState<Phase>("writing");
  useEffect(() => {
    if (!draft) return;
    setNote("");
    setWithConversation(true);
    setPhase("writing");
  }, [draft]);
  if (!draft) return null;

  const send = async () => {
    setPhase("sending");
    try {
      await api("/api/delio/report", { method: "POST", body: JSON.stringify({ note, bot: draft.bot, transcript: withConversation ? draft.transcript : "" }) });
      setPhase("sent");
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      setPhase(status === 409 ? "not-connected" : status === 429 ? "too-many" : "failed");
    }
  };
  const done = phase !== "writing" && phase !== "sending";

  return (
    <ConfirmDialog
      open
      tone="neutral"
      icon={<LifeBuoy size={18} aria-hidden="true" />}
      title={t("report.title")}
      confirmLabel={done ? t("report.close") : t("report.send")}
      pending={phase === "sending"}
      onCancel={closeProblemReport}
      onConfirm={() => { if (done) closeProblemReport(); else if (note.trim() || withConversation) void send(); }}
      body={done ? <p role="status">{t(RESULT[phase])}</p> : (
        <div className="flex flex-col gap-3">
          <p>{t("report.intro")}</p>
          <textarea
            data-report-note
            value={note}
            maxLength={2000}
            rows={4}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("report.notePlaceholder")}
            className="w-full resize-none rounded-[10px] border-[0.5px] border-ink/15 bg-card px-3 py-2 text-[14px] text-ink outline-none focus:border-accent"
          />
          <label className="flex items-start gap-2 text-[13px] text-ink-secondary">
            <input type="checkbox" data-report-conversation checked={withConversation} onChange={(event) => setWithConversation(event.target.checked)} className="mt-0.5" />
            <span>{t("report.includeConversation", { name: draft.bot })}</span>
          </label>
          <p className="text-[12px] text-ink-tertiary">{t("report.privacy")}</p>
        </div>
      )}
    />
  );
}
