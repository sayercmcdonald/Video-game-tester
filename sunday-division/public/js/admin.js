/* Studio dashboard — confirmations for approval-gated actions, keyboard access to scrolling regions. */
(function () {
  'use strict';
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var submitter = event.submitter;
    var message = (submitter && submitter.getAttribute('data-confirm')) || form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) event.preventDefault();
  });

  // Wide tables and long records scroll inside their card on small screens. Make each region
  // that actually scrolls reachable and nameable from the keyboard (WCAG 2.1.1).
  var mark = function () {
    document.querySelectorAll('.card, .json, .a-main > .a-table').forEach(function (el) {
      var s = getComputedStyle(el);
      var scrolls = (s.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) || (s.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1);
      if (scrolls && !el.hasAttribute('data-scroll-region')) {
        el.setAttribute('data-scroll-region', '');
        el.setAttribute('tabindex', '0');
        if (el.tagName !== 'TABLE' && !el.hasAttribute('aria-label')) {
          var heading = el.querySelector('h2');
          el.setAttribute('role', 'region');
          el.setAttribute('aria-label', heading ? heading.textContent.trim() : 'Scrollable details');
        }
      } else if (!scrolls && el.hasAttribute('data-scroll-region')) {
        ['data-scroll-region', 'tabindex', 'role', 'aria-label'].forEach(function (a) { el.removeAttribute(a); });
      }
    });
  };
  mark();
  var timer = null;
  window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(mark, 150); });
})();
