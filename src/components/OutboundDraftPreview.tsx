import { useState } from "react";
import { Paperclip, Pencil } from "lucide-react";
import { t } from "@/lib/i18n";
import type { OutboundDraft } from "../../shared/outbound";
import { ASK_QUIET_ANSWER, ASK_SECONDARY_BUTTON } from "./AskCard";

const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function Field({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 gap-2 text-[13px] leading-[18px]">
    <span className="shrink-0 text-ink-secondary">{label}</span>
    <span dir="auto" className="min-w-0 break-words text-ink">{value}</span>
  </div>;
}

/** The sends a card asks about, written out: who each goes to, its subject, its text and its files. `onEdit` offers the
 * person their own version of a single text; the bot sends that version again, and it asks once more. */
export function OutboundDraftPreview({ drafts, onEdit }: { drafts: readonly OutboundDraft[]; onEdit?: (edited: { subject?: string; body?: string }) => void }) {
  const editable = onEdit && drafts.length === 1 && drafts[0]!.body !== undefined ? drafts[0]! : null;
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(editable?.subject ?? "");
  const [body, setBody] = useState(editable?.body ?? "");
  if (drafts.length === 0) return null;
  if (editing && editable && onEdit) {
    const changed = body.trim() !== (editable.body ?? "").trim() || subject.trim() !== (editable.subject ?? "").trim();
    return <div data-outbound-draft-edit className="mt-2 flex flex-col gap-2 rounded-xl bg-ink/[0.045] px-3 py-2.5">
      {editable.to && <Field label={t("outboundDraft.to")} value={editable.to} />}
      {editable.subject !== undefined && <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("outboundDraft.subject")}
        <input dir="auto" value={subject} onChange={(event) => setSubject(event.target.value)} className="rounded-lg border border-hairline bg-card px-2.5 py-1.5 text-[13px] text-ink" />
      </label>}
      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("outboundDraft.text")}
        <textarea dir="auto" value={body} rows={8} onChange={(event) => setBody(event.target.value)} className="min-h-[120px] resize-y rounded-lg border border-hairline bg-card px-2.5 py-1.5 text-[13px] leading-[19px] text-ink" />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className={ASK_QUIET_ANSWER} onClick={() => setEditing(false)}>{t("outboundDraft.cancelEdit")}</button>
        <button type="button" data-outbound-draft-resend className={ASK_SECONDARY_BUTTON} disabled={!changed || !body.trim()}
          onClick={() => onEdit({ ...(editable.subject !== undefined ? { subject } : {}), body })}>{t("outboundDraft.resend")}</button>
      </div>
    </div>;
  }
  return <div data-outbound-drafts className="mt-2 flex flex-col gap-2">
    {drafts.map((draft, index) => (
      <div key={index} data-outbound-draft className="flex flex-col gap-1 rounded-xl bg-ink/[0.045] px-3 py-2.5">
        {draft.to && <Field label={t("outboundDraft.to")} value={draft.to} />}
        {draft.subject && <Field label={t("outboundDraft.subject")} value={draft.subject} />}
        {draft.body && <p dir="auto" className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words text-[13px] leading-[19px] text-ink">{draft.body}</p>}
        {draft.files?.length ? <div className="mt-1 flex flex-wrap gap-1.5">
          {draft.files.map((file) => <span key={file.name} className="inline-flex items-center gap-1 rounded-md bg-ink/[0.06] px-2 py-0.5 text-[12px] text-ink-secondary">
            <Paperclip size={12} aria-hidden="true" />{file.name} · {size(file.bytes)}
          </span>)}
        </div> : null}
      </div>
    ))}
    {editable && <div className="flex justify-end">
      <button type="button" data-outbound-draft-edit-open className={ASK_QUIET_ANSWER} onClick={() => setEditing(true)}>
        <Pencil size={13} aria-hidden="true" className="me-1 inline" />{t("outboundDraft.edit")}
      </button>
    </div>}
  </div>;
}
