export const BILLING_REFRESH_SCRIPT = `(() => {
  const script = document.currentScript;
  const version = Number(script.dataset.paymentVersion);
  const url = '/api/billing/status?workspace=' + encodeURIComponent(script.dataset.workspace);
  let timer;
  let running = false;
  let stopped = false;
  let controller;
  async function check() {
    if (stopped || running || document.visibilityState === 'hidden') return;
    running = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (response.status === 401 || response.redirected) { location.reload(); return; }
      if (!response.ok) return;
      const state = await response.json();
      if (Number.isSafeInteger(state.paymentVersion) && state.paymentVersion !== version) {
        location.reload();
        return;
      }
      const pending = document.querySelector('[data-billing-payment-pending]');
      if (pending) pending.hidden = !state.pending;
    } catch {} finally {
      clearTimeout(timeout);
      running = false;
      if (!stopped) timer = setTimeout(check, 5000);
    }
  }
  function resume() { clearTimeout(timer); void check(); }
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', () => { stopped = false; resume(); });
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); controller?.abort(); });
  void check();
})();`;
