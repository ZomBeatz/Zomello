#!/usr/bin/env bash
# Build Zomello for the Mac App Store: a signed .pkg to upload with Apple's Transporter app.
# Run it on the Mac, in the Zomello folder:  ./scripts/mac-app-store.sh
#
# One-time setup:
#   1. Certificates. In Xcode: Settings > Accounts > your team > Manage Certificates > + and add
#      "Apple Distribution" and "Mac Installer Distribution" (skip any you already have).
#   2. Provisioning profile. developer.apple.com > Certificates, IDs & Profiles > Profiles > + >
#      Distribution: "Mac App Store Connect" > App ID com.zombeatz.zomello (the iPhone app's, the
#      same app) > your Apple Distribution certificate > name it "Zomello Mac App Store" > Download.
#      Save the file as src-tauri/embedded.provisionprofile (it's ignored by git).
#   3. App Store Connect > Zomello > Add Platform > macOS.
#
# The App Store copy runs in Apple's sandbox (src-tauri/Entitlements.appstore.plist): start at login
# and the firewall step are left to macOS's own settings, the same as the Microsoft Store copy.
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE=src-tauri/embedded.provisionprofile
if [ ! -f "$PROFILE" ]; then
  echo "Missing $PROFILE. Download the Mac App Store provisioning profile (see the top of this script)." >&2
  exit 1
fi

APP_IDENTITY=$(security find-identity -v -p codesigning | grep -o '"Apple Distribution: [^"]*"' | head -1 | tr -d '"' || true)
PKG_IDENTITY=$(security find-identity -v | grep -oE '"(3rd Party Mac Developer Installer|Mac Installer Distribution): [^"]*"' | head -1 | tr -d '"' || true)
if [ -z "$APP_IDENTITY" ] || [ -z "$PKG_IDENTITY" ]; then
  echo "Need both an \"Apple Distribution\" and a \"Mac Installer Distribution\" certificate in your keychain." >&2
  echo "Add them in Xcode: Settings > Accounts > your team > Manage Certificates > +." >&2
  exit 1
fi
echo "Signing the app with:     $APP_IDENTITY"
echo "Signing the installer with: $PKG_IDENTITY"

VERSION=$(python3 -c "import json; print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
npm ci

# One app for Apple silicon and Intel Macs, sandboxed, with the profile inside it.
APPLE_SIGNING_IDENTITY="$APP_IDENTITY" npx tauri build --target universal-apple-darwin --bundles app \
  --config src-tauri/tauri.appstore.conf.json

APP=$(find src-tauri/target/universal-apple-darwin/release/bundle/macos -maxdepth 1 -name '*.app' | head -1)
codesign --verify --strict "$APP"
codesign -d --entitlements - "$APP" 2>/dev/null | grep -q app-sandbox || { echo "The app isn't sandboxed; the App Store would refuse it." >&2; exit 1; }

OUT="$HOME/Desktop/Zomello-$VERSION-mac-app-store.pkg"
xcrun productbuild --sign "$PKG_IDENTITY" --component "$APP" /Applications "$OUT"
echo
echo "Done: $OUT"
echo "Open Transporter, sign in, drag the .pkg in and click Deliver. It shows up under the macOS"
echo "platform in App Store Connect (and in TestFlight) after Apple processes it."
echo "If Transporter says this version was already uploaded, raise the version and build again."
