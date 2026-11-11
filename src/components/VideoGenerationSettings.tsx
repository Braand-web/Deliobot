import { useEffect, useState, type ReactNode } from "react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
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
export function useFalModels(kind: "image" | "video", wanted: boolean): FalModelList | null {
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

/** Video clips on fal.ai. `keyCard` is the fal.ai key card, passed in when the image settings above do not already show it. */
export function VideoGenerationSettings({ keyCard }: { keyCard?: ReactNode }) {
  const { state, dispatch } = useStore();
  const video = state.config?.videoGen;
  const falKey = state.config?.imageGen?.falConfigured === true;
  const enabled = video?.enabled === true;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const models = useFalModels("video", enabled);
  const model = video?.model || VIDEO_DEFAULT_MODEL;
  const choices: ModelChoice[] = models && models.source !== "builtin" ? models.models : VIDEO_MODEL_CHOICES.map((choice) => ({ ...choice, group: "recommended" }));
  const disabled = saving || !state.config;

  const save = async (patch: object) => {
    setSaving(true);
    setError(null);
    try {
      const next: ConfigStatus = await api("/api/config", { method: "PUT", body: JSON.stringify({ videoGen: patch }) });
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
        <h3 className="text-[15px] font-medium text-ink">{t("videoGen.title")}</h3>
        <p className="text-[13px] leading-relaxed text-ink-secondary">{t("videoGen.intro")}</p>
        <p role="status" data-testid="video-gen-status" className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <span className={cn("size-1.5 shrink-0 rounded-full", video?.ready ? "bg-success" : enabled ? "bg-warning" : "bg-raised-hover")} />
          {video?.ready ? t("videoGen.status.ready") : enabled ? t("videoGen.status.needsKey") : t("videoGen.status.off")}
        </p>
      </section>
      <SettingRow title={t("videoGen.enabled.label")} subtitle={t("videoGen.enabled.help")}>
        <Switch checked={enabled} disabled={disabled} onClick={() => void save({ enabled: !enabled })} aria-label={t("videoGen.enabled.label")} data-testid="video-gen-enabled" />
      </SettingRow>
      {enabled && (
        <>
          <SettingRow title={t("decider.model.label")} subtitle={models?.source === "builtin" ? t("decider.model.builtinNote") : t("videoGen.model.help")}>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select
                className="w-64 max-w-full"
                data-testid="video-gen-model"
                value={draft !== null ? OTHER_MODEL : model}
                onChange={(event) => {
                  if (event.target.value === OTHER_MODEL) return setDraft(model);
                  setDraft(null);
                  void save({ model: event.target.value });
                }}
                disabled={disabled}
                aria-label={t("videoGen.model.label")}
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
                  placeholder={VIDEO_DEFAULT_MODEL}
                  aria-label={t("videoGen.model.idLabel")}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-64 max-w-full min-w-0 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
                />
              )}
            </div>
          </SettingRow>
          <SettingRow title={t("videoGen.maxSeconds.label")} subtitle={t("videoGen.maxSeconds.help")}>
            <Select className="w-20" data-testid="video-gen-seconds" value={String(video?.maxSeconds ?? VIDEO_SECONDS_DEFAULT)} disabled={disabled}
              onChange={(event) => void save({ maxSeconds: Number(event.target.value) })} aria-label={t("videoGen.maxSeconds.label")}>
              {Array.from({ length: VIDEO_SECONDS_MAX }, (_, index) => index + 1).map((seconds) => <option key={seconds} value={seconds}>{seconds}</option>)}
            </Select>
          </SettingRow>
          <SettingRow title={t("videoGen.maxPerTurn.label")} subtitle={t("videoGen.maxPerTurn.help")}>
            <Select className="w-20" data-testid="video-gen-max" value={String(video?.maxPerTurn ?? VIDEO_MAX_PER_TURN_DEFAULT)} disabled={disabled}
              onChange={(event) => void save({ maxPerTurn: Number(event.target.value) })} aria-label={t("videoGen.maxPerTurn.label")}>
              {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
            </Select>
          </SettingRow>
          <SettingRow title={t("videoGen.dailyCap.label")} subtitle={t("videoGen.dailyCap.help")}>
            <Select className="w-24" data-testid="video-gen-daily" value={String(video?.dailyCap ?? VIDEO_DAILY_CAP_DEFAULT)} disabled={disabled}
              onChange={(event) => void save({ dailyCap: Number(event.target.value) })} aria-label={t("videoGen.dailyCap.label")}>
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
