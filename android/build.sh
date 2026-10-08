#!/bin/bash
# Stride APK build — manual aapt2/d8 pipeline (no Gradle needed)
# Prerequisites: JDK 17+ and Android SDK with platforms;android-34 and
# build-tools;34.0.0. Set ANDROID_HOME (default: ~/android-sdk).
set -e
export JAVA_HOME="${JAVA_HOME:-$HOME/jdk17}"
export PATH=$JAVA_HOME/bin:$PATH
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
BT=$ANDROID_HOME/build-tools/34.0.0
AJAR=$ANDROID_HOME/platforms/android-34/android.jar
cd "$(dirname "$0")"

echo "== 0. assemble web assets =="
rm -rf assets && mkdir -p assets/www
cp -r ../web/. assets/www/
cp native-bridge.js assets/www/
# load the native bridge before app.js
sed -i 's|<script src="app.js"></script>|<script src="native-bridge.js"></script>\n<script src="app.js"></script>|' assets/www/index.html
grep -q 'native-bridge.js' assets/www/index.html && echo "assets ready"

echo "== 1. compile resources =="
rm -rf build && mkdir -p build/gen build/classes build/dex
$BT/aapt2 compile --dir res -o build/compiled_res.zip

echo "== 2. link =="
$BT/aapt2 link -o build/app-unsigned.apk \
  -I "$AJAR" \
  --manifest AndroidManifest.xml \
  -A assets \
  --java build/gen \
  build/compiled_res.zip

echo "== 3. compile java =="
javac -source 8 -target 8 -nowarn -encoding UTF-8 \
  -cp "$AJAR" -d build/classes \
  $(find src build/gen -name "*.java")

echo "== 4. dex =="
$BT/d8 --lib "$AJAR" --min-api 26 --output build/dex \
  $(find build/classes -name "*.class")

echo "== 5. add dex + align =="
cp build/app-unsigned.apk build/app.apk
(cd build/dex && zip -q ../app.apk classes.dex)
$BT/zipalign -f 4 build/app.apk build/app-aligned.apk

echo "== 6. keystore + sign =="
if [ ! -f stride.keystore ]; then
  keytool -genkeypair -keystore stride.keystore -alias stride \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass stride123 -keypass stride123 \
    -dname "CN=Stride Fitness, OU=Self, O=Self, L=IN, C=IN"
fi
$BT/apksigner sign --ks stride.keystore \
  --ks-pass pass:stride123 --key-pass pass:stride123 \
  --out stride.apk build/app-aligned.apk

echo "== 7. verify =="
$BT/apksigner verify --print-certs stride.apk | head -4
$BT/aapt dump badging stride.apk | head -6
ls -la stride.apk
echo "BUILD OK"
