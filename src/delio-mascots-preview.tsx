import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CarvedAvatar } from "@/components/CarvedAvatar";
import type { MausColor, MausState } from "@/lib/mascot";
import { DELIO_BODY_IDS, HALLOWEEN_BODY_IDS, CARVED_BODIES } from "../shared/carved-bodies";
import "./styles.css";

const COLORS: MausColor[] = ["blue", "purple", "orange", "green", "pink", "teal", "red", "yellow", "cyan", "coral"];
const STATES: MausState[] = ["idle", "happy", "thinking", "working", "surprised", "sleeping"];
const animated = !new URLSearchParams(location.search).has("still");

function Page() {
  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 36, fontFamily: "Inter, system-ui, sans-serif", background: "#fafafa", minHeight: "100vh" }}>
      <section>
        <h2 style={{ margin: "0 0 16px", fontSize: 20 }}>Delio pack</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
          {DELIO_BODY_IDS.map((id, i) => (
            <div key={id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #eee", borderRadius: 16, padding: 16 }}>
              <CarvedAvatar body={id} color={COLORS[i]} size={150} animated={animated} />
              <b style={{ fontSize: 14 }}>{CARVED_BODIES[id].name}</b>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 style={{ margin: "0 0 16px", fontSize: 20 }}>Expressions</h2>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {STATES.map((s) => (
            <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <CarvedAvatar body="sprout" color="blue" size={110} state={s} animated={false} />
              <span style={{ fontSize: 12 }}>{s}</span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 style={{ margin: "0 0 16px", fontSize: 20 }}>Toutes les couleurs</h2>
        {DELIO_BODY_IDS.map((id) => (
          <div key={id} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {COLORS.map((c) => <CarvedAvatar key={c} body={id} color={c} size={56} animated={false} />)}
          </div>
        ))}
      </section>
      <section>
        <h2 style={{ margin: "0 0 16px", fontSize: 20 }}>À côté du pack existant (Halloween)</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {HALLOWEEN_BODY_IDS.map((id, i) => <CarvedAvatar key={id} body={id} color={COLORS[i]} size={72} animated={false} />)}
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Page /></StrictMode>);
