# Stride — Your training, tracked by you

Stride is a **private, offline-first fitness tracker for Android**. No account, no
sign-up, no cloud, no ads, no subscriptions — every step, workout, and stat stays
on your phone and yours alone.

## What it does

- **All-day step counting** — counts your steps in the background, even with the
  screen off, using your phone's hardware step-counter sensor (accelerometer
  fallback on phones that lack one). A small persistent notification shows the
  step service is running.
- **GPS workouts** — track walks, runs, rides, and gym sessions with live
  distance, pace, duration, and calories, plus a map of the route you took.
- **Manual exercise log** — log strength training or anything else with duration
  and intensity.
- **Goal ring & daily stats** — set a daily step goal and watch the ring fill;
  see steps, distance, active minutes, and calories at a glance.
- **Weekly charts & 14-day history** — trends for steps, workouts, and calories.
- **Export / import** — back up everything as JSON and restore it anytime.

## How it works

The Android app is a native shell (WebView) around the tracker, plus a
**foreground service** that reads the hardware `TYPE_STEP_COUNTER` sensor — that
is what keeps counting steps with the screen off. Phones without the hardware
counter fall back to accelerometer-based peak detection. GPS workouts use your
phone's location sensor.

All data is stored locally on the device. Nothing is ever uploaded, because there
is no server to upload it to.

The same tracker is also available as an installable **web app (PWA)** in `web/`
— host it on any static server and add it to your home screen.

## Download & install

1. Go to [**Releases**](https://github.com/kolanukondaisaaceliot-hue/stride/releases)
   and download the latest `stride.apk`.
2. Open the file on your phone. Android will ask you to allow "Install unknown
   apps" for your browser or file manager — allow it once.
3. Open Stride, grant motion and location permissions when asked, and start moving.

Permissions used, and why: activity recognition + motion sensors (step counting),
location (GPS workouts), foreground service (step counting with the screen off),
boot completed (restart step counting after a reboot).

## Build the APK yourself

Prerequisites: JDK 17+, Android SDK with `platforms;android-34` and
`build-tools;34.0.0` (see `android/build.sh` header).

```bash
cd android
bash build.sh        # produces stride.apk (debug key auto-generated on first run)
```

The build uses `aapt2`/`d8` directly — no Gradle needed. For a Play Store release
build, sign with your own upload key (`apksigner`) and target the latest API.

## Run the web version

```bash
cd web
python3 -m http.server 8080
# open http://localhost:8080 in Chrome (Add to Home screen to install)
```

## License

MIT — do whatever you want with it.
