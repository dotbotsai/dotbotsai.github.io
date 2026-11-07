/* dotBots Market: light / dark theme. Follows the device until the visitor picks one, then remembers it. */
(function () {
  var KEY = "dotbots-theme", root = document.documentElement;
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function system() { return window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; }
  function apply(t) {
    root.setAttribute("data-theme", t);
    var b = document.getElementById("themeBtn");
    if (b) { var n = t === "light" ? "dark" : "light"; b.setAttribute("aria-label", "Switch to " + n + " mode"); b.title = "Switch to " + n + " mode"; }
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", t === "light" ? "#f5f5f7" : "#0e0f13");
  }
  apply(saved() || system());
  if (window.matchMedia) {
    var mq = matchMedia("(prefers-color-scheme: light)");
    var on = function () { if (!saved()) apply(system()); };
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
  }
  document.addEventListener("DOMContentLoaded", function () {
    var b = document.getElementById("themeBtn");
    apply(root.getAttribute("data-theme"));
    if (b) b.addEventListener("click", function () {
      var t = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      try { localStorage.setItem(KEY, t); } catch (e) {}
      apply(t);
    });
  });
})();
