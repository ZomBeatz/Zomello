#!/usr/bin/env bash
# Build the Zomello Android app and install it on the phone plugged in by USB (with USB debugging on).
# First time: install Android Studio with its SDK and NDK (see docs/apps.md → "Build it on your PC").
#   npm run android            optimized build (small, fast), signed with Android Studio's test key
#   npm run android -- --debug  debug build (big; lets a computer inspect the app over USB)
# Either installs and updates over itself on your phone. For a build to hand to other people, use
# GitHub's "Build apps", which signs with your own key.
set -euo pipefail
cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
# The newest NDK, as a plain path (a fancy `ls` alias can't get in the way here).
if [[ -z "${NDK_HOME:-}" || ! -f "${NDK_HOME}/source.properties" ]]; then
  NDK_HOME="$(find "$ANDROID_HOME/ndk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1)"
fi
export NDK_HOME
[[ -n "$NDK_HOME" ]] || { echo "No Android NDK found. In Android Studio: SDK Manager → SDK Tools → NDK (Side by side)."; exit 1; }
# Android's build tools want the Java that comes with Android Studio, not the newest system Java.
for jbr in /opt/android-studio/jbr "$HOME/android-studio/jbr" /usr/lib/jvm/java-21-openjdk /usr/lib/jvm/java-17-openjdk; do
  [[ -x "$jbr/bin/java" ]] && { export JAVA_HOME="$jbr"; break; }
done

adb get-state >/dev/null 2>&1 || { echo "No phone found. Plug it in, turn on USB debugging, and tap Allow on the phone."; exit 1; }

if [[ ! -d src-tauri/gen/android ]]; then
  npx tauri android init --ci
  # Zomello's icons for Android (made in a temporary folder so the desktop icons stay as they are).
  tmp="$(mktemp -d)"
  npx tauri icon src-tauri/icons/icon.png -o "$tmp" >/dev/null
  cp -r "$tmp"/android/* src-tauri/gen/android/app/src/main/res/
  rm -rf "$tmp"
fi

if [[ "${1:-}" == "--debug" ]]; then
  npx tauri android build --debug --apk --target aarch64
  apk="$(find src-tauri/gen/android/app/build/outputs/apk -name '*debug*.apk' | head -1)"
else
  npx tauri android build --apk --target aarch64
  unsigned="$(find src-tauri/gen/android/app/build/outputs/apk -name '*release*.apk' | head -1)"
  # Sign with the test key Android Studio made (~/.android/debug.keystore), the same one debug builds use.
  bt="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
  apk="$(mktemp -d)/Zomello.apk"
  "$bt/zipalign" -f 4 "$unsigned" "$apk.aligned"
  "$bt/apksigner" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --ks-key-alias androiddebugkey --out "$apk" "$apk.aligned"
fi
adb install -r "$apk"
adb shell monkey -p com.zombeatz.zomello -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
echo "Installed and opened Zomello on the phone."
