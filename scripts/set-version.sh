#!/usr/bin/env bash
# Sets Zomello's version everywhere it's written: ./scripts/set-version.sh 0.6.2
# Then write the release notes (CHANGELOG.md, What's New, the guide), commit, tag v<version> and push.
set -euo pipefail
cd "$(dirname "$0")/.."

new="${1:-}"
if ! [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 <major.minor.patch>, for example $0 0.6.2" >&2
  exit 1
fi
old="$(node -p 'require("./package.json").version')"
if [ "$old" = "$new" ]; then
  echo "Already $new."
  exit 0
fi

# package.json and package-lock.json (the lock's first two "version" lines are Zomello's own)
npm version "$new" --no-git-tag-version --allow-same-version >/dev/null
# Desktop, Android and Windows read this one
sed -i.bak "s/\"version\": \"$old\"/\"version\": \"$new\"/" src-tauri/tauri.conf.json
# Rust app and server (and their lock entries)
sed -i.bak "0,/^version = \"$old\"/s//version = \"$new\"/" src-tauri/Cargo.toml server/Cargo.toml
sed -i.bak "/^name = \"zomello\"$/{n;s/\"$old\"/\"$new\"/;}" src-tauri/Cargo.lock
sed -i.bak "/^name = \"zomello-server\"$/{n;s/\"$old\"/\"$new\"/;}" server/Cargo.lock
# iPhone and Mac App Store
sed -i.bak "s/$old/$new/g" src-tauri/gen/apple/project.yml src-tauri/gen/apple/zomello_iOS/Info.plist
find . -name '*.bak' -not -path './node_modules/*' -not -path '*/target/*' -delete

echo "Zomello $old -> $new"
echo "Still by hand:"
echo "  - CHANGELOG.md: a '## $new' section"
echo "  - src/components/WhatsNew.tsx: 'version' and items, if this release gets a New in Zomello note"
echo "  - zombeatz-docs/site/zomello/whats-new.md (and 'New in version' lines)"
echo "Then: git add -A && git commit -m \"Zomello $new\" && git tag v$new && git push origin main v$new"
