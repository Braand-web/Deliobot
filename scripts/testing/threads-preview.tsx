import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { setAnalyticsEnabled, setEmailGateDone } from "../../src/lib/analytics";
import { ADVANCED_MODE_KEY, setAdvancedMode } from "../../src/lib/interface-mode";
import { markSimpleModePromptSeen } from "../../src/lib/simple-mode-prompt";
import { applySkinChoice, readSkinChoice } from "../../src/lib/skins";
import "../../src/styles.css";

// This entry point is served only by the disposable verification launcher.
// The voice-latency harness opts in with ?odbVoiceProbe=1; the recorder in
// src/lib/voice-latency-probe stays inert without this sink.
if (new URLSearchParams(location.search).has("odbVoiceProbe")) {
  (window as typeof window & { __odbVoiceProbe?: unknown[] }).__odbVoiceProbe = [];
}
setAnalyticsEnabled(false);
// Every launch is a new browser, so it opens in Simple mode as a new install does, unless a test chose a mode first.
// ?onboarding=1 plays a brand-new install.
if (localStorage.getItem(ADVANCED_MODE_KEY) == null) setAdvancedMode(false);
if (!new URLSearchParams(location.search).has("onboarding")) setEmailGateDone("skipped");
// Every launch is a new browser, so the once-per-browser Simple mode popup shows only with ?simpleModePrompt=1.
if (!new URLSearchParams(location.search).has("simpleModePrompt")) markSimpleModePromptSeen();
applySkinChoice(readSkinChoice());
createRoot(document.getElementById("root")!).render(<App />);
