/* TempMail — Install app button (PWA beforeinstallprompt + manual fallback). */
(function () {
  var btn = document.getElementById('installBtn');
  if (!btn) return;
  var modal = document.getElementById('installModal');
  var closeBtn = document.getElementById('installModalClose');

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }
  if (isStandalone()) {
    btn.hidden = true;
    return;
  }

  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
  });
  window.addEventListener('appinstalled', function () {
    deferred = null;
    btn.hidden = true;
    if (modal) modal.hidden = true;
  });

  btn.addEventListener('click', async function () {
    if (deferred) {
      deferred.prompt();
      try {
        await deferred.userChoice;
      } catch (_) {
        /* user dismissed — nothing to do */
      }
      deferred = null;
    } else if (modal) {
      modal.hidden = false;
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      modal.hidden = true;
    });
  }
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.hidden = true;
    });
  }
})();
