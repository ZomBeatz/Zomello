# Android build tools for the scripts in this folder (sourced, not run): the SDK, the newest NDK as a
# plain path, and the Java that comes with Android Studio.
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

