import { useEffect, useState, type ReactNode } from "react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { MUSIC_DAILY_CAP_DEFAULT, MUSIC_MAX_PER_TURN_DEFAULT, MUSIC_MODEL_CHOICES, MUSIC_SECONDS_MAX } from "../../shared/music-generation";
import {
  VIDEO_DAILY_CAP_DEFAULT, VIDEO_DEFAULT_MODEL, VIDEO_MAX_PER_TURN_DEFAULT, VIDEO_MODEL_CHOICES, VIDEO_SECONDS_DEFAULT, VIDEO_SECONDS_MAX,
} from "../../shared/video-generation";
import { SettingRow, Switch } from "./SettingsPrimitives";
import { Select } from "./Select";

type ModelChoice = { id: string; name: string; group: "recommended" | "more" };
export type FalModelList = { source: "fal" | "builtin"; models: ModelChoice[] };
const OTHER_MODEL = "\u0000other";
const DAILY_CAPS = [5, 10, 20, 50, 100, 200];

/** fal.ai's live catalog of one kind, loaded once when a setting needs it. */
export function useFalModels(kind: "image" | "video" | "music", wanted: boolean): FalModelList | null {
  const [list, setList] = useState<FalModelList | null>(null);
  useEffect(() => {
    if (!wanted || list) return;
    let cancelled = false;
    api<FalModelList>(`/api/media/fal-models?kind=${kind}`).then(
      (answer) => { if (!cancelled) setList(Array.isArray(answer?.models) ? answer : { source: "builtin", models: [] }); },
      () => { if (!cancelled) setList({ source: "builtin", models: [] }); },
    );
    return () => { cancelled = true; };
  }, [kind, wanted, list]);
  return list;
}

type MediaKind = "video" | "music";
const MEDIA: Record<MediaKind, { configKey: "videoGen" | "musicGen"; choices: readonly { id: string; name: string }[]; defaultModel: string;
  secondsDefault: number; secondsChoices: readonly number[]; perTurnDefault: number; dailyDefault: number; prefix: "videoGen" | "musicGen" }> = {
  video: { configKey: "videoGen", choices: VIDEO_MODEL_CHOICES, defaultModel: VIDEO_DEFAULT_MODEL, secondsDefault: VIDEO_SECONDS_DEFAULT,
    secondsChoices: Array.from({ length: VIDEO_SECONDS_MAX }, (_, index) => index + 1), perTurnDefault: VIDEO_MAX_PER_TURN_DEFAULT, dailyDefault: VIDEO_DAILY_CAP_DEFAULT, prefix: "videoGen" },
  music: { configKey: "musicGen", choices: MUSIC_MODEL_CHOICES, defaultModel: "auto", secondsDefault: 60,
    secondsChoices: [10, 15, 30, 45, 60, 90, 120, MUSIC_SECONDS_MAX], perTurnDefault: MUSIC_MAX_PER_TURN_DEFAULT, dailyDefault: MUSIC_DAILY_CAP_DEFAULT, prefix: "musicGen" },
};

/** Video clips on fal.ai. `keyCard` is the fal.ai key card, passed in when the image settings above do not already show it. */
export function VideoGenerationSettings({ keyCard }: { keyCard?: ReactNode }) {
  return <MediaGenerationSettings kind="video" keyCard={keyCard} />;
}

/** Music, songs and sound effects on fal.ai, with the same key. */
export function MusicGenerationSettings({ keyCard }: { keyCard?: ReactNode }) {
  return <MediaGenerationSettings kind="music" keyCard={keyCard} />;
}

function MediaGenerationSettings({ kind, keyCard }: { kind: MediaKind; keyCard?: ReactNode }) {
  const spec = MEDIA[kind];
  const k = (suffix: string) => `${spec.prefix}.${suffix}` as LocaleKey;
  const { state, dispatch } = useStore();
  const video = state.config?.[spec.configKey];
  const falKey = state.config?.imageGen?.falConfigured === true;
  const enabled = video?.enabled === true;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const models = useFalModels(kind, enabled);
  const model = video?.model || spec.defaultModel;
  const choices: ModelChoice[] = models && models.source !== "builtin" ? models.models : spec.choices.map((choice) => ({ ...choice, group: "recommended" }));
  const disabled = saving || !state.config;

  const save = async (patch: object) => {
    setSaving(true);
    setError(null);
    try {
      const next: ConfigStatus = await api("/api/config", { method: "PUT", body: JSON.stringify({ [spec.configKey]: patch }) });
      dispatch({ type: "configStatus", config: next });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft.trim() && draft.trim() !== model) void save({ model: draft.trim() });
  };

  return (
    <>
      <section className="space-y-2 px-4 pt-4">
        <h3 className="text-[15px] font-medium text-ink">{t(k("title"))}</h3>
        <p className="text-[13px] leading-relaxed text-ink-secondary">{t(k("intro"))}</p>
        <p role="status" data-testid={`${kind}-gen-status`} className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <span className={cn("size-1.5 shrink-0 rounded-full", video?.ready ? "bg-success" : enabled ? "bg-warning" : "bg-raised-hover")} />
          {video?.ready ? t(k("status.ready")) : enabled ? t(k("status.needsKey")) : t(k("status.off"))}
        </p>
      </section>
      <SettingRow title={t(k("enabled.label"))} subtitle={t(k("enabled.help"))}>
        <Switch checked={enabled} disabled={disabled} onClick={() => void save({ enabled: !enabled })} aria-label={t(k("enabled.label"))} data-testid={`${kind}-gen-enabled`} />
      </SettingRow>
      {enabled && (
        <>
          <SettingRow title={t("decider.model.label")} subtitle={models?.source === "builtin" ? t("decider.model.builtinNote") : t(k("model.help"))}>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select
                className="w-64 max-w-full"
                data-testid={`${kind}-gen-model`}
                value={draft !== null ? OTHER_MODEL : model}
                onChange={(event) => {
                  if (event.target.value === OTHER_MODEL) return setDraft(model);
                  setDraft(null);
                  void save({ model: event.target.value });
                }}
                disabled={disabled}
                aria-label={t(k("model.label"))}
              >
                {!choices.some((choice) => choice.id === model) && <option value={model}>{model}</option>}
                {(["recommended", "more"] as const).map((group) => {
                  const inGroup = choices.filter((choice) => choice.group === group);
                  return inGroup.length > 0 && (
                    <optgroup key={group} label={t(group === "recommended" ? "decider.model.recommended" : "decider.model.more")}>
                      {inGroup.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                    </optgroup>
                  );
                })}
                <option value={OTHER_MODEL}>{t("imageGen.model.other")}</option>
              </Select>
              {draft !== null && (
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commit}
                  onKeyDown={(event) => event.key === "Enter" && commit()}
                  disabled={disabled}
                  placeholder={spec.choices[1]?.id ?? ""}
                  aria-label={t(k("model.idLabel"))}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-64 max-w-full min-w-0 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
                />
              )}
            </div>
          </SettingRow>
          <SettingRow title={t(k("maxSeconds.label"))} subtitle={t(k("maxSeconds.help"))}>
            <Select className="w-20" data-testid={`${kind}-gen-seconds`} value={String(video?.maxSeconds ?? spec.secondsDefault)} disabled={disabled}
              onChange={(event) => void save({ maxSeconds: Number(event.target.value) })} aria-label={t(k("maxSeconds.label"))}>
              {spec.secondsChoices.map((seconds) => <option key={seconds} value={seconds}>{seconds}</option>)}
            </Select>
          </SettingRow>
          <SettingRow title={t(k("maxPerTurn.label"))} subtitle={t(k("maxPerTurn.help"))}>
            <Select className="w-20" data-testid={`${kind}-gen-max`} value={String(video?.maxPerTurn ?? spec.perTurnDefault)} disabled={disabled}
              onChange={(event) => void save({ maxPerTurn: Number(event.target.value) })} aria-label={t(k("maxPerTurn.label"))}>
              {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
            </Select>
          </SettingRow>
          <SettingRow title={t(k("dailyCap.label"))} subtitle={t(k("dailyCap.help"))}>
            <Select className="w-24" data-testid={`${kind}-gen-daily`} value={String(video?.dailyCap ?? spec.dailyDefault)} disabled={disabled}
              onChange={(event) => void save({ dailyCap: Number(event.target.value) })} aria-label={t(k("dailyCap.label"))}>
              {DAILY_CAPS.map((cap) => <option key={cap} value={cap}>{cap}</option>)}
            </Select>
          </SettingRow>
          {!falKey && keyCard}
        </>
      )}
      {error && <p role="alert" className="px-4 text-[12px] text-danger">{error}</p>}
    </>
  );
}
