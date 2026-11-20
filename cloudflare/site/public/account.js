(() => {
  // compte.deliobot.fun sets delio-known=1 on this domain once someone signs in from this browser.
  const known = document.cookie.split(";").some((part) => part.trim() === "delio-known=1");
  const portal = document.documentElement.dataset.portal || "https://compte.deliobot.fun";
  let ref = null;
  try {
    const kept = JSON.parse(localStorage.getItem("delio-ref") || "null");
    ref = kept && kept.until > Date.now() ? kept.code : null;
  } catch {}
  const path = known ? "/login" : "/login?intent=signup";
  const href = portal + (ref ? `${path}${path.includes("?") ? "&" : "?"}ref=${encodeURIComponent(ref)}` : path);
  document.querySelectorAll("[data-account-link]").forEach((link) => {
    link.textContent = known ? "Se connecter" : "Créer un compte";
    link.href = href;
  });

  const params = new URLSearchParams(location.search);
  const welcome = document.querySelector("[data-welcome]");
  if (params.get("bienvenue") !== "1" || !welcome) return;
  welcome.hidden = false;
  const ua = navigator.userAgent;
  const os = /Android|iPhone|iPad/.test(ua) ? null : /Windows/.test(ua) ? "windows" : /Mac/.test(ua) ? null : /Linux/.test(ua) ? "linux" : null;
  if (/Android|iPhone|iPad/.test(ua)) welcome.textContent = "✓ Votre compte est créé. Deliobot s'installe sur un ordinateur Windows ou Linux : ouvrez deliobot.fun sur votre ordinateur pour le télécharger.";
  const tile = os && document.querySelector(`[data-download="${os}"]`);
  if (tile) tile.classList.add("chosen");
  params.delete("bienvenue");
  history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + "#telecharger");
  requestAnimationFrame(() => document.getElementById("telecharger")?.scrollIntoView({ block: "start" }));
})();
