/** Linux without a GPU (electron/linux-gpu.mjs) redraws every backdrop blur on the CPU, so styles.css drops the pop-ups' blur. */
export function applySoftwareRendering(): void {
  if (window.odb?.softwareRendering === true) document.documentElement.dataset.softwareRendering = "";
}
