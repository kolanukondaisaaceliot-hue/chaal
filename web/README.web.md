# Stride — Self-Hosted Fitness Tracker

A private, offline-first fitness tracker that runs as an installable web app on
your Android phone. No account, no cloud, no ads — all data stays on your device
in localStorage.

**Features**
- All-day step counting via the phone's accelerometer (Generic Sensor API with
  DeviceMotion fallback, peak-detection algorithm, adjustable sensitivity)
- GPS workout tracking for walk / run / ride: live timer, distance, pace, route
  map, auto-pause, wake lock so the screen stays on
- Manual exercise logging (strength, yoga, swimming, HIIT…) with calorie estimates
- Dashboard with goal ring, weekly charts, 14-day history, workout history
- Export / import JSON backups, PWA install support, works fully offline

**Files**
- `index.html`, `styles.css`, `app.js` — the app (no build step, no dependencies)
- `manifest.webmanifest`, `sw.js` — PWA install + offline support
- `icons/` — app icons

## Run it on your Android phone (3 ways)

**Option A — hosted on your own Netlify (recommended, HTTPS included)**
1. Deploy this folder to Netlify (drag-drop on app.netlify.com while logged in).
2. Open the `https://…netlify.app` URL in Chrome on your phone.
3. Chrome menu (⋮) → **Add to Home screen** (or **Install app**).
4. Open Stride from the home screen, enable Motion + Location when asked.

**Option B — any static host**
Any static host with HTTPS works (GitHub Pages, Cloudflare Pages, your own
server with nginx/caddy). Upload the folder contents, open the URL in Chrome,
Add to Home screen.

**Option C — from your computer on the same Wi-Fi (no internet needed)**
1. On your computer, in this folder: `python3 -m http.server 8080`
2. Find your computer's LAN IP (e.g. `192.168.1.5`).
3. On your phone (same Wi-Fi), open Chrome to `http://192.168.1.5:8080`.
   Note: motion sensors require a secure context, so step counting may not work
   over plain `http://` LAN — use Option A/B for full sensor access.

## Important notes
- **HTTPS is required** for motion sensors and geolocation in Chrome. `localhost`
  also counts as secure.
- **Web apps can't count steps in the background** when closed or when the phone
  is locked (Android limitation). Keep Stride open while you move; it holds a
  wake lock during workouts.
- If the browser blocks the motion sensor, tap the lock/tune icon in Chrome's
  address bar → Site settings → Motion sensors → Allow.
