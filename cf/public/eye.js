/* The eye on a password box.
   Every password field in the app, on every page, gets a small gold eye at its
   right edge. Press it and the password shows; press it again and it hides.
   Nothing is sent anywhere and nothing is remembered: the moment the page is
   left the password is hidden again.

   Fields that appear later (the booking sheet, the portal, the operations hub)
   are picked up as soon as they are added to the page. */
(function () {
  "use strict";

  var OPEN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.6 12S5.3 5.4 12 5.4 22.4 12 22.4 12 18.7 18.6 12 18.6 1.6 12 1.6 12Z"/><circle cx="12" cy="12" r="3.3"/></svg>';
  var SHUT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4.2 20.8 20.4"/><path d="M9.9 6c.7-.2 1.4-.3 2.1-.3 6.7 0 10.4 6.3 10.4 6.3a19 19 0 0 1-3 3.7"/><path d="M6.6 7.9A18.6 18.6 0 0 0 1.6 12S5.3 18.3 12 18.3c1.5 0 2.8-.3 4-.8"/><path d="M9.8 9.9a3.3 3.3 0 0 0 4.5 4.6"/></svg>';

  function dress(input) {
    if (!input || input.dataset.eye === "on") return;
    if (input.type !== "password") return;
    input.dataset.eye = "on";

    var skin = document.createElement("span");
    skin.className = "pw-wrap";

    var eye = document.createElement("button");
    eye.type = "button";
    eye.className = "pw-eye";
    eye.tabIndex = 0;
    eye.setAttribute("aria-label", "Show the password");
    eye.setAttribute("aria-pressed", "false");
    eye.title = "Show the password";
    eye.innerHTML = SHUT;

    input.parentNode.insertBefore(skin, input);
    skin.appendChild(input);
    skin.appendChild(eye);
    input.classList.add("has-eye");

    eye.addEventListener("click", function (ev) {
      ev.preventDefault();
      var showing = input.getAttribute("type") === "text";
      input.setAttribute("type", showing ? "password" : "text");
      eye.innerHTML = showing ? SHUT : OPEN;
      eye.classList.toggle("open", !showing);
      var label = showing ? "Show the password" : "Hide the password";
      eye.setAttribute("aria-label", label);
      eye.setAttribute("aria-pressed", showing ? "false" : "true");
      eye.title = label;
      // keep the cursor where the person left it
      try {
        var at = input.value.length;
        input.focus();
        input.setSelectionRange(at, at);
      } catch (e) {}
    });
  }

  function sweep(root) {
    var list = (root || document).querySelectorAll('input[type="password"]:not([data-eye])');
    for (var i = 0; i < list.length; i++) dress(list[i]);
  }

  function start() {
    sweep(document);
    if (!window.MutationObserver) return;
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches('input[type="password"]')) dress(node);
          else sweep(node);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
