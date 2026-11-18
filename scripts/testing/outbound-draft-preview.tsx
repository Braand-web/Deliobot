// The "Send on your behalf?" strip with a draft, alone on a page, for screenshots of each skin.
import { createRoot } from "react-dom/client";
import { PendingApprovalPanel } from "../../src/components/PendingApproval";
import { OutboundDraftPreview } from "../../src/components/OutboundDraftPreview";
import { setLocale } from "../../src/lib/i18n";
import { applySkin } from "../../src/lib/skins";
import type { Message } from "../../src/state/store";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
setLocale(params.get("lang") === "en" ? "en" : "fr");
applySkin(params.get("skin") === "daylight" ? "daylight" : "midnight");
const draft = { app: "Gmail", to: "awa.diallo@clinique-eclat.sn", subject: "Votre facture de novembre", body: "Bonjour Awa,\n\nVous trouverez ci-joint la facture de novembre (250 000 FCFA). Le paiement est attendu sous 7 jours.\n\nMerci pour votre confiance,\nL'équipe Delio", files: [{ name: "facture-novembre.pdf", bytes: 48_211 }] };
const message: Message = { id: "m1", role: "bot", kind: "options", at: 1, card: { title: "Send on your behalf?", subtitle: "Gmail · Send email", options: ["Allow", "Deny"], requestId: "r1", tool: "GMAIL_SEND_EMAIL",
  heldCode: "approval.held.outbound", outboundRequest: { tool: "GMAIL_SEND_EMAIL", app: "Gmail", calls: [{ app: "Gmail", label: "Send email" }], drafts: [draft] } } } as Message;
const pending = { message, requestId: "r1", tool: "GMAIL_SEND_EMAIL", detail: "", heldCode: "approval.held.outbound" };

createRoot(document.getElementById("root")!).render(<main className="min-h-screen bg-app p-6 text-ink">
  <div className="mx-auto flex max-w-[640px] flex-col gap-6">
    <div className="overflow-hidden rounded-[18px] border border-hairline bg-card">
      <PendingApprovalPanel pending={pending} count={1} index={0} botName="Compta" />
    </div>
    <div className="overflow-hidden rounded-[18px] border border-hairline bg-card p-4">
      <OutboundDraftPreview drafts={[draft]} onEdit={() => {}} />
    </div>
  </div>
</main>);
