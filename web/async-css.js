/**
 * Async CSS media activation for web/index.html (V-3-1b).
 * Replaces inline `media="print" onload="this.media='all'"` handlers:
 * links marked `data-async-css` load non-blocking (print media) then
 * activate to `all` once loaded. No inline handlers / no fetch / no inline scripts.
 * Timing: sheet present means already loaded (load event missed); otherwise
 * attach a load listener. Either path flips the media exactly once.
 */
(function () {
  var links = document.querySelectorAll('link[media="print"][data-async-css]');
  function activate(l) {
    if (l.media === 'print') l.media = 'all';
  }
  for (var i = 0; i < links.length; i++) {
    var l = links[i];
    if (l.sheet) activate(l);
    else l.addEventListener('load', function () { activate(this); });
  }
})();
