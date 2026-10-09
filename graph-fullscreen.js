(function (root) {
  "use strict";
  function setup(stage, button, canvas, onError) {
    const document = stage.ownerDocument;
    const requestFullscreen = stage.requestFullscreen || stage.webkitRequestFullscreen || stage.mozRequestFullScreen || stage.msRequestFullscreen;
    const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    let wasFullscreen = false, pending = false;
    const supported = typeof requestFullscreen === "function" && typeof exitFullscreen === "function" && (document.fullscreenEnabled !== false || typeof document.fullscreenEnabled === "undefined");
    function sync() {
      const active = fullscreenElement() === stage;
      button.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
      button.setAttribute("aria-pressed", String(active));
      button.title = supported ? (active ? "Exit fullscreen (Esc)" : "Show graph fullscreen (F)")
        : "Fullscreen is unavailable in this browser";
      button.disabled = !supported || pending;
      if (active) canvas.focus({preventScroll: true});
      else if (wasFullscreen) button.focus({preventScroll: true});
      wasFullscreen = active;
    }
    async function toggle() {
      if (!supported || pending) return;
      pending = true; button.disabled = true;
      try {
        if (fullscreenElement() === stage) await exitFullscreen.call(document);
        else await requestFullscreen.call(stage);
      } catch (error) {
        onError("Could not change fullscreen mode: " + error.message);
      } finally { pending = false; sync(); }
    }
    button.addEventListener("click", toggle);
    canvas.addEventListener("keydown", event => {
      if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && !event.isComposing) {
        event.preventDefault(); toggle();
      }
    });
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    document.addEventListener("mozfullscreenchange", sync);
    document.addEventListener("MSFullscreenChange", sync);
    sync();
  }
  root.EgdFullscreen = {setup};
  if (typeof module !== "undefined") module.exports = {setup};
})(globalThis);
