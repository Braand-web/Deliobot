import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { Bot } from "@/state/store";
import { Select } from "../Select";
import { useFalModels } from "../VideoGenerationSettings";

type MediaKind = "image" | "video" | "music";
const KINDS: ReadonlyArray<[MediaKind, LocaleKey]> = [["image", "media.bot.image"], ["video", "media.bot.video"], ["music", "media.bot.music"]];

function MediaModelRow({ kind, label, value, onChange }: { kind: MediaKind; label: LocaleKey; value: string; onChange: (model: string) => void }) {
  const list = useFalModels(kind, true);
  const models = list?.models ?? [];
  const known = value === "auto" || models.some((model) => model.id === value);
  return (
    <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
      {t(label)}
      <Select id={`bot-media-${kind}`} className="max-w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="auto">{t("media.bot.auto")}</option>
        {!known && <option value={value}>{value}</option>}
        <optgroup label={t("media.bot.recommended")}>
          {models.filter((model) => model.group === "recommended" && model.id !== "auto").map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </optgroup>
        {models.some((model) => model.group === "more") && (
          <optgroup label={t("media.bot.more")}>
            {models.filter((model) => model.group === "more").map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </optgroup>
        )}
      </Select>
    </label>
  );
}

/** The bot's own image, video and music models; Auto picks one per request. An empty object clears them. */
export function MediaModelsCard({ bot, onChange }: { bot: Bot; onChange: (media: NonNullable<Bot["media"]>) => void }) {
  const media = bot.media ?? {};
  const set = (kind: MediaKind, model: string) => {
    const next = { ...media, [kind]: model === "auto" ? undefined : model };
    onChange(Object.fromEntries(Object.entries(next).filter(([, model]) => model)));
  };
  return (
    <div data-bot-media className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{t("media.bot.title")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("media.bot.help")}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {KINDS.map(([kind, label]) => <MediaModelRow key={kind} kind={kind} label={label} value={media[kind] ?? "auto"} onChange={(model) => set(kind, model)} />)}
      </div>
    </div>
  );
}
