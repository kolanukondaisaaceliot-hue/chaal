/* Stride native bridge (APK build).
   When running inside the Android WebView wrapper, window.StrideNative is
   injected by MainActivity and step counting uses the phone's hardware
   step-counter sensor via the foreground service instead of web sensors. */
(function () {
  if (!window.StrideNative) return;
  window.__strideNative = true;
  function hideInstall() {
    var b = document.getElementById('installBtn');
    if (b) b.style.display = 'none';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hideInstall);
  else hideInstall();
})();
