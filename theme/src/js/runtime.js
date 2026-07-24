export function createRuntimeContext() {
  var root = document.documentElement;
  var runtimeScript = document.currentScript;
  var runtimeAssets = runtimeScript ? runtimeScript.dataset : {};

  function loadScriptOnce(id, source) {
    if (!source) return Promise.reject(new Error("Missing script source for " + id));
    var existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === "true") return Promise.resolve();
      return new Promise(function (resolve, reject) {
        existing.addEventListener("load", resolve, {once: true});
        existing.addEventListener("error", reject, {once: true});
      });
    }
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.id = id;
      script.src = source;
      script.async = true;
      script.addEventListener("load", function () {
        script.dataset.loaded = "true";
        resolve();
      }, {once: true});
      script.addEventListener("error", reject, {once: true});
      document.head.appendChild(script);
    });
  }

  function runWhenIdle(callback, timeout) {
    if ("requestIdleCallback" in window) {
      return window.requestIdleCallback(callback, {timeout: timeout || 1500});
    }
    return window.setTimeout(callback, Math.min(timeout || 1500, 250));
  }

  return {root, runtimeAssets, loadScriptOnce, runWhenIdle};
}
