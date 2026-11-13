/* Sunday Division — progressive enhancement only. The site works without this file. */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    // Header: solid once the page has scrolled; mobile menu toggle.
    var header = document.querySelector('[data-header]');
    if (header) {
      var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 24); };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      var toggle = header.querySelector('[data-nav-toggle]');
      if (toggle) {
        toggle.addEventListener('click', function () {
          var open = header.classList.toggle('is-open');
          toggle.setAttribute('aria-expanded', String(open));
          toggle.firstElementChild.textContent = open ? 'Close' : 'Menu';
        });
      }
    }

    // Reveal on scroll.
    var items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      items.forEach(function (el, i) {
        el.style.transitionDelay = (i % 3) * 70 + 'ms';
        observer.observe(el);
      });
    }

    // Intake form: list chosen files and enforce the same limits the server does.
    var input = document.querySelector('[data-file-input]');
    var listEl = document.querySelector('[data-file-list]');
    if (input && listEl) {
      input.addEventListener('change', function () {
        listEl.textContent = '';
        var files = Array.prototype.slice.call(input.files);
        var problem = '';
        if (files.length > 6) problem = 'Attach up to 6 files.';
        files.forEach(function (file) {
          var li = document.createElement('li');
          li.textContent = file.name + ' — ' + (file.size / 1048576).toFixed(1) + ' MB';
          listEl.appendChild(li);
          if (file.size > 8 * 1048576) problem = '"' + file.name + '" is larger than 8 MB.';
        });
        input.setCustomValidity(problem);
        if (problem) input.reportValidity();
      });
    }

    // Avoid double submissions.
    document.querySelectorAll('form').forEach(function (form) {
      form.addEventListener('submit', function () {
        var button = form.querySelector('button[type="submit"]');
        if (button && form.checkValidity()) {
          setTimeout(function () { button.disabled = true; }, 0);
        }
      });
    });
  });
})();
