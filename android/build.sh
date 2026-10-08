#!/bin/bash
# Chaal APK build — manual aapt2/d8 pipeline (no Gradle needed)
# Prerequisites: JDK 17+ and Android SDK with platforms;android-34 and
# build-tools;34.0.0. Set ANDROID_HOME (default: ~/android-sdk).
#
# Health Connect client libraries are downloaded automatically on first run
# (~9MB, from Google Maven + Maven Central) into android/libs/ (gitignored).
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

echo "== 0b. health-connect libs =="
mkdir -p libs
if [ ! -f libs/guava.jar ]; then
  G="https://dl.google.com/dl/android/maven2"
  M="https://repo.maven.apache.org/maven2"
  dl() { curl -sL --retry 2 -o "libs/$2" "$1" && echo "  got $2"; }
  dl "$G/androidx/health/connect/connect-client/1.1.0/connect-client-1.1.0.aar" hc-client.aar
  dl "$G/androidx/health/connect/connect-client-proto/1.1.0/connect-client-proto-1.1.0.jar" proto.jar
  dl "$G/androidx/health/connect/connect-client-external-protobuf/1.1.0/connect-client-external-protobuf-1.1.0.jar" protobuf.jar
  dl "$M/org/jetbrains/kotlin/kotlin-stdlib/2.0.21/kotlin-stdlib-2.0.21.jar" kotlin-stdlib.jar
  dl "$M/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.7.3/kotlinx-coroutines-core-jvm-1.7.3.jar" coroutines-core.jar
  dl "$M/org/jetbrains/kotlinx/kotlinx-coroutines-android/1.7.3/kotlinx-coroutines-android-1.7.3.jar" coroutines-android.jar
  dl "$M/com/google/guava/guava/31.1-android/guava-31.1-android.jar" guava.jar
  dl "$M/com/google/guava/failureaccess/1.0.1/failureaccess-1.0.1.jar" failureaccess.jar
  dl "$M/com/google/guava/listenablefuture/9999.0-empty-to-avoid-conflict-with-guava/listenablefuture-9999.0-empty-to-avoid-conflict-with-guava.jar" listenablefuture.jar
  dl "$M/org/jspecify/jspecify/1.0.0/jspecify-1.0.0.jar" jspecify.jar
  dl "$G/androidx/core/core-ktx/1.12.0/core-ktx-1.12.0.aar" core-ktx.aar
  dl "$G/androidx/core/core/1.12.0/core-1.12.0.aar" core.aar
  dl "$G/androidx/annotation/annotation/1.8.1/annotation-1.8.1.jar" annotation.jar
  dl "$G/androidx/activity/activity/1.12.0/activity-1.12.0.aar" activity.aar
fi
# extract classes.jar from AARs
mkdir -p libs/classes
for a in libs/*.aar; do
  n=$(basename "$a" .aar)
  if [ ! -f "libs/classes/$n.jar" ]; then
    unzip -p "$a" classes.jar > "libs/classes/$n.jar" && echo "  extracted $n"
  fi
done
# patch Health Connect client for D8 (null MethodParameters names crash D8 8.2.2)
if [ ! -f libs/asm.jar ]; then
  curl -sL --retry 2 -o libs/asm.jar "https://repo.maven.apache.org/maven2/org/ow2/asm/asm/9.7/asm-9.7.jar" \
    && echo "  got asm.jar"
fi
mkdir -p build/patcher
javac -cp libs/asm.jar -d build/patcher tools/PatchHc.java
# Patch all third-party jars: some ship MethodParameters with null names,
# which crashes D8 8.2.2 (drop them; debug-only info).
for j in libs/*.jar libs/classes/*.jar; do
  case "$j" in *asm.jar) continue;; esac
  java -cp "libs/asm.jar:build/patcher" PatchHc "$j" "build/$(basename $j).patched"
  mv "build/$(basename $j).patched" "$j"
done
LIBCP=$(ls libs/*.jar libs/classes/*.jar | tr '\n' ':')
echo "libs ready"

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
  -cp "$AJAR:$LIBCP" -d build/classes \
  $(find src build/gen -name "*.java")

echo "== 4. dex =="
$BT/d8 --lib "$AJAR" --min-api 26 --output build/dex \
  $(find build/classes -name "*.class") \
  $(ls libs/*.jar libs/classes/*.jar)

echo "== 5. add dex + align =="
cp build/app-unsigned.apk build/app.apk
(cd build/dex && zip -q ../app.apk classes*.dex)
$BT/zipalign -f 4 build/app.apk build/app-aligned.apk

echo "== 6. keystore + sign =="
if [ ! -f stride.keystore ]; then
  keytool -genkeypair -keystore stride.keystore -alias stride \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass stride123 -keypass stride123 \
    -dname "CN=Chaal Fitness, OU=Self, O=Self, L=IN, C=IN"
fi
$BT/apksigner sign --ks stride.keystore \
  --ks-pass pass:stride123 --key-pass pass:stride123 \
  --out chaal.apk build/app-aligned.apk

echo "== 7. verify =="
$BT/apksigner verify --print-certs chaal.apk | head -4
$BT/aapt dump badging chaal.apk | head -6
ls -la chaal.apk
echo "BUILD OK"
