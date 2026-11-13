/* Sunday Division Command — progressive enhancement. Every screen works without it. */
(function () {
  'use strict';
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  // ── Installable app: register the service worker for /command/ ──────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/command/sw.js', { scope: '/command/' }).catch(function () { /* optional */ });
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        return data;
      });
    });
  }

  // ── Prevent double submission of confirmations and other forms ──────
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.hasAttribute('data-chat-form')) return;
    var btn = form.querySelector('button[type="submit"]');
    if (btn) { setTimeout(function () { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }, 0); }
  });

  // ── Command Chat ─────────────────────────────────────────────────────
  var form = document.querySelector('[data-chat-form]');
  if (form) {
    var log = document.querySelector('[data-chat-log]');
    var input = form.querySelector('textarea');
    var button = form.querySelector('button[type="submit"]');
    var conv = form.querySelector('input[name="conversation_id"]');
    var project = form.querySelector('input[name="project_id"]');
    var suggest = document.querySelector('[data-suggest]');
    var busy = false;

    var grow = function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); form.requestSubmit(); }
    });
    if (suggest) suggest.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fill]');
      if (!b) return;
      input.value = b.getAttribute('data-fill');
      grow();
      setPrompts(false);
      input.focus();
    });
    var scrollEnd = function () { window.scrollTo({ top: document.body.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
    var toggle = form.querySelector('[data-prompts-toggle]');
    var setPrompts = function (open) {
      if (!suggest) return;
      suggest.hidden = !open;
      if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    if (toggle) toggle.addEventListener('click', function () { setPrompts(suggest && suggest.hidden); });
    var addUser = function (text) {
      var li = document.createElement('li');
      li.className = 'ui-msg ui-msg--user';
      var b = document.createElement('div');
      b.className = 'ui-msg__bubble';
      b.textContent = text;
      li.appendChild(b);
      log.appendChild(li);
    };
    var addTyping = function () {
      var li = document.createElement('li');
      li.className = 'ui-msg ui-msg--assistant ui-msg--typing';
      li.innerHTML = '<div class="ui-reply"><span class="ui-typing" role="status" aria-label="Command is working"><i></i><i></i><i></i></span></div>';
      log.appendChild(li);
      return li;
    };
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      button.disabled = true;
      setPrompts(false);
      var recent = document.getElementById('recent');
      if (recent) recent.remove();
      addUser(text);
      input.value = '';
      grow();
      var typing = addTyping();
      scrollEnd();
      post('/command/api/chat', { text: text, conversationId: conv.value || null, projectId: project.value || null })
        .then(function (data) {
          typing.remove();
          // Trusted markup: rendered by the server with every value escaped.
          log.insertAdjacentHTML('beforeend', data.html);
          if (!conv.value) {
            conv.value = data.conversationId;
            history.replaceState(null, '', '/command/chat/' + data.conversationId);
          }
        })
        .catch(function (err) {
          typing.remove();
          var li = document.createElement('li');
          li.className = 'ui-msg ui-msg--assistant ui-msg--error';
          var b = document.createElement('div');
          b.className = 'ui-reply';
          b.textContent = err.message;
          li.appendChild(b);
          log.appendChild(li);
        })
        .finally(function () { busy = false; button.disabled = false; scrollEnd(); input.focus(); });
    });
    if (log.children.length) scrollEnd();
  }

  // ── Settings: time zone from this device ────────────────────────────
  var tzBtn = document.querySelector('[data-tz-fill]');
  if (tzBtn) tzBtn.addEventListener('click', function () {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) document.getElementById('timezone').value = tz;
  });

  // ── Settings: push notifications on this device ─────────────────────
  var push = document.querySelector('[data-push]');
  if (push) {
    var status = push.querySelector('[data-push-status]');
    var on = push.querySelector('[data-push-enable]');
    var off = push.querySelector('[data-push-disable]');
    var key = push.getAttribute('data-key');
    var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    var b64ToBytes = function (s) {
      var pad = '='.repeat((4 - (s.length % 4)) % 4);
      var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    };
    var refresh = function () {
      if (!supported) {
        status.textContent = 'This browser cannot receive push notifications here. On iPhone, open Command from the Home Screen (iOS 16.4 or later).';
        return;
      }
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        on.hidden = Boolean(sub);
        off.hidden = !sub;
        if (Notification.permission === 'denied') { status.textContent = 'Notifications are blocked for Command in this browser’s settings.'; on.hidden = true; }
        else status.textContent = sub ? 'Push notifications are on for this device.' : 'Push notifications are off for this device.';
      });
    };
    if (on) on.addEventListener('click', function () {
      on.disabled = true;
      Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error('Permission was not granted.');
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      }).then(function (sub) {
        var ua = navigator.userAgent;
        var label = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'Browser';
        return post('/command/api/push/subscribe', { subscription: sub.toJSON(), label: label });
      }).then(refresh).catch(function (err) { status.textContent = err.message; }).finally(function () { on.disabled = false; });
    });
    if (off) off.addEventListener('click', function () {
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        if (!sub) return null;
        return post('/command/api/push/unsubscribe', { subscription: sub.toJSON() }).then(function () { return sub.unsubscribe(); });
      }).then(refresh).catch(function (err) { status.textContent = err.message; });
    });
    refresh();
  }
})();
