#!/usr/bin/env bash
# Build the Android app for Google Play: a signed .aab ("Android App Bundle") to upload in Play Console.
# The first time, it makes your upload key (keep it and its password safe; every update needs it).
#   npm run android:release
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh

PROPS=src-tauri/gen/android/keystore.properties
if [[ ! -f "$PROPS" ]]; then
  KEY_DIR="$HOME/zomello-keys"
  KEY="$KEY_DIR/zomello-upload.jks"
  echo "First release: making your Google Play upload key at $KEY"
  echo "Pick a password (at least 6 characters) and keep it somewhere safe, like your password manager."
  read -rsp "Password: " PW; echo
  read -rsp "Same password again: " PW2; echo
  [[ "$PW" == "$PW2" && ${#PW} -ge 6 ]] || { echo "The passwords don't match (or are too short). Nothing was made."; exit 1; }
  mkdir -p "$KEY_DIR" && chmod 700 "$KEY_DIR"
  if [[ ! -f "$KEY" ]]; then
    keytool -genkeypair -keystore "$KEY" -alias upload -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass "$PW" -keypass "$PW" -dname "CN=ZomBeatz Media, O=ZomBeatz Media" >/dev/null
  fi
  umask 077
  printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=upload\nkeyPassword=%s\n' "$KEY" "$PW" "$PW" > "$PROPS"
  echo "Upload key made. Back up $KEY_DIR (e.g. to a USB stick); without it you can't update the app."
fi

VERSION=$(python3 -c "import json; print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
echo "Building Zomello $VERSION for Google Play…"
npx tauri android build --aab
AAB=$(find src-tauri/gen/android/app/build/outputs/bundle -name '*release*.aab' | head -1)
echo
echo "Done: $AAB"
echo "Upload it in Play Console → your app → Test and release. Each upload needs a higher version:"
echo "change \"version\" in src-tauri/tauri.conf.json (now $VERSION) before the next one."
