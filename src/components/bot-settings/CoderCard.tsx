import { useState } from "react";

import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { Select } from "../Select";
import { Switch } from "../SettingsPrimitives";

type Coder = NonNullable<Bot["coder"]>;
const ROUNDS = [1, 2, 3, 4, 5, 6];

/** Coder mode: checks after every change, a review by another engine, and the rounds the bot gets to fix them. */
export function CoderCard({ bot, onChange }: { bot: Bot; onChange: (coder: Coder | null) => void }) {
  const { state } = useStore();
  const coder: Coder = bot.coder ?? { enabled: false };
  const [commands, setCommands] = useState((coder.verify ?? []).join("\n"));
  const set = (patch: Partial<Coder>) => onChange({ ...coder, ...patch });
  const reviewers = state.instances
    .filter((instance) => instance.snapshot.state === "available" && instance.snapshot.authenticated !== false)
    .flatMap((instance) => instance.models.options
      .filter((model) => !model.orgBlocked && !(instance.instanceId === bot.modelSelection.instanceId && model.id === bot.modelSelection.model))
      .map((model) => ({ value: `${instance.instanceId}\n${model.id}`, label: `${instance.displayName} · ${model.label ?? model.id}`, instanceId: instance.instanceId, model: model.id })));
  const reviewValue = coder.review ? `${coder.review.instanceId}\n${coder.review.model}` : "";
  return (
    <div data-bot-coder className="rounded-xl bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-medium text-ink">{t("coder.title")}</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">{t("coder.help")}</div>
        </div>
        <Switch checked={coder.enabled} aria-label={t("coder.title")} onClick={() => set({ enabled: !coder.enabled })} />
      </div>
      {coder.enabled && (
        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
            {t("coder.reviewer")}
            <Select id="bot-coder-reviewer" className="max-w-full" value={reviewValue}
              onChange={(event) => {
                const picked = reviewers.find((option) => option.value === event.target.value);
                set({ review: picked ? { instanceId: picked.instanceId, model: picked.model } : undefined });
              }}>
              <option value="">{t("coder.reviewerNone")}</option>
              {reviewValue && !reviewers.some((option) => option.value === reviewValue) && <option value={reviewValue}>{coder.review?.model}</option>}
              {reviewers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
            <span className="text-[12px]">{t("coder.reviewerHelp")}</span>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
            {t("coder.checks")}
            <textarea rows={3} value={commands} placeholder={t("coder.checksPlaceholder")}
              onChange={(event) => setCommands(event.target.value)}
              onBlur={() => set({ verify: commands.split("\n").map((line: string) => line.trim()).filter(Boolean).slice(0, 8) })}
              className="rounded-lg border border-hairline bg-inset px-2.5 py-1.5 font-mono text-[12.5px] text-ink" />
            <span className="text-[12px]">{t("coder.checksHelp")}</span>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
            {t("coder.rounds")}
            <Select id="bot-coder-rounds" className="max-w-[120px]" value={String(coder.maxRounds ?? 3)} onChange={(event) => set({ maxRounds: Number(event.target.value) })}>
              {ROUNDS.map((rounds) => <option key={rounds} value={rounds}>{rounds}</option>)}
            </Select>
          </label>
        </div>
      )}
    </div>
  );
}
