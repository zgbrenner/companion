// MAIN-world readiness beacon for the OpenAI observer.
//
// MAIN and isolated content scripts both run at document_start, but Chrome does
// not guarantee which world becomes ready first. Repeating this non-secret
// signal for a short bounded window lets the isolated bridge transfer its
// private MessagePort without exposing authentication material.
(() => {
  const MESSAGE = { type: "cuc:openai-main-ready" };
  const origin = location.origin;
  let attempts = 0;
  const announce = () => {
    attempts += 1;
    try { window.postMessage(MESSAGE, origin); } catch { /* best effort */ }
    if (attempts >= 50) clearInterval(timer);
  };
  announce();
  const timer = setInterval(announce, 100);
})();
