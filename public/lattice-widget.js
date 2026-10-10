/* Lattice embed loader. No dashboard auth, customer data, or HTML injection. */
(() => {
  "use strict";
  const script = document.currentScript;
  if (!script || !script.dataset.agent) return;
  const agent = script.dataset.agent;
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(agent)) return;
  if (document.querySelector(`[data-lattice-agent="${agent}"]`)) return;
  const app = new URL(script.src).origin;
  const host = document.createElement("div");
  host.setAttribute("data-lattice-agent", agent);
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `:host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483000;font:14px system-ui,sans-serif}button{min-height:48px;padding:12px 20px;border:1px solid #bdc9bd;border-radius:24px;color:#fff;background:#173b2b;font:600 14px system-ui,sans-serif;cursor:pointer}button:focus-visible,iframe:focus-visible{outline:3px solid #a76f2e;outline-offset:3px}iframe{display:block;border:1px solid #bdc9bd;background:#f4f5ee;border-radius:8px;width:min(390px,calc(100vw - 32px));height:min(680px,calc(100dvh - 100px));margin-bottom:12px;box-shadow:0 12px 40px #173b2b30}iframe[hidden]{display:none}@media(max-width:480px){:host{right:16px;bottom:16px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}`;
  const button = document.createElement("button");
  button.textContent = "Ask support";
  button.setAttribute("aria-label", "Open website support");
  button.setAttribute("aria-expanded", "false");
  let frame = null;
  function close() {
    if (frame) frame.hidden = true;
    button.textContent = "Ask support";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Open website support");
    button.focus();
  }
  button.addEventListener("click", () => {
    if (frame && !frame.hidden) { close(); return; }
    if (!frame) {
      frame = document.createElement("iframe");
      frame.title = "Website support chat";
      frame.referrerPolicy = "origin";
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox");
      frame.src = `${app}/widget?agent=${encodeURIComponent(agent)}&site=${encodeURIComponent(location.origin)}`;
      root.insertBefore(frame, button);
    }
    frame.hidden = false;
    button.textContent = "Close support";
    button.setAttribute("aria-label", "Close website support");
    button.setAttribute("aria-expanded", "true");
    frame.addEventListener("load", () => frame.focus(), { once: true });
    frame.focus();
  });
  window.addEventListener("message", event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== app) return;
    if (event.data?.type === "lattice:ready") frame.contentWindow.postMessage({ type: "lattice:site", site: location.origin }, app);
    if (event.data?.type === "lattice:close") close();
  });
  root.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  root.append(style, button);
  (document.body || document.documentElement).append(host);
})();
