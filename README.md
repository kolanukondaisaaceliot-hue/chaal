# Stride — Self-Hosted Fitness Tracker

A private, offline-first fitness tracker for Android. No account, no cloud, no ads —
all data stays on your phone.

**Android app** (`android/`) — native WebView shell + foreground service that counts
steps all day using the hardware step-counter sensor (works even with the screen off),
with accelerometer fallback. GPS workout tracking, installable APK.

**Web app** (`web/`) — the same tracker as an installable PWA: sensor step counting,
GPS run/walk/ride workouts with route maps, manual exercise logging, goal ring,
weekly charts, 14-day history, JSON export/import. Run it with any static server.

## Download

Grab the latest APK from [**Releases**](https://github.com/kolanukondaisaaceliot-hue/stride/releases) — install it directly
on your phone (allow "Install unknown apps" when prompted).

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
