#!/usr/bin/env bash
# Builds and signs the Reflexity Admin APK straight from the Android SDK's command-line tools. No Gradle and no libraries,
# so there is nothing to download or keep patched.
#
#   ./build.sh               build + sign  ->  build/reflexity-admin.apk
#   ./build.sh --init-key    create the signing key once (stored under ~/.config/reflexity-android, password in the keyring)
#
# The signing key must stay the same for every update, or the phone refuses the new APK. Its password lives only in the
# GNOME keyring (service=reflexity-android account=keystore) and is handed to the tools through the environment.
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_SDK_ROOT:-$HOME/Android-Sdk}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
KEYSTORE="${RFX_KEYSTORE:-$HOME/.config/reflexity-android/release.keystore}"
ALIAS="reflexity-admin"
OUT=build

keyring_password() { secret-tool lookup service reflexity-android account keystore; }

if [[ "${1:-}" == "--init-key" ]]; then
  [[ -e "$KEYSTORE" ]] && { echo "A signing key already exists at $KEYSTORE; refusing to replace it." >&2; exit 1; }
  mkdir -p "$(dirname "$KEYSTORE")"; chmod 700 "$(dirname "$KEYSTORE")"
  RFX_KS_PASS="$(openssl rand -base64 33 | tr -d '/+=\n')"
  export RFX_KS_PASS
  keytool -genkeypair -keystore "$KEYSTORE" -alias "$ALIAS" -keyalg RSA -keysize 3072 -validity 36500 \
    -storepass:env RFX_KS_PASS -keypass:env RFX_KS_PASS -dname "CN=Reflexity RAM Admin, O=Reflexity RAM, C=CA"
  printf '%s' "$RFX_KS_PASS" | secret-tool store --label="Reflexity Admin app signing key" service reflexity-android account keystore
  chmod 600 "$KEYSTORE"
  echo "Signing key created: $KEYSTORE (password stored in the keyring, nothing printed)."
  exit 0
fi

[[ -f "$KEYSTORE" ]] || { echo "No signing key. Run ./build.sh --init-key once." >&2; exit 1; }
RFX_KS_PASS="$(keyring_password)"; export RFX_KS_PASS
[[ -n "$RFX_KS_PASS" ]] || { echo "The signing key's password is not in the keyring." >&2; exit 1; }

VERSION_NAME="$(sed -n 's/.*APP_VERSION = "\(.*\)";/\1/p' app/src/main/java/com/reflexityram/admin/Config.java)"
VERSION_CODE="${VERSION_CODE:-$(git rev-list --count HEAD 2>/dev/null || echo 1)}"

rm -rf "$OUT"; mkdir -p "$OUT"/{compiled,gen,classes,dex}
"$BT/aapt2" compile --dir app/src/main/res -o "$OUT/compiled/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest app/src/main/AndroidManifest.xml \
  --min-sdk-version 30 --target-sdk-version 35 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --java "$OUT/gen" "$OUT/compiled/res.zip"
javac --release 11 -Xlint:all -classpath "$JAR" -d "$OUT/classes" $(find app/src/main/java "$OUT/gen" -name '*.java')
"$BT/d8" --release --min-api 30 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
(cd "$OUT/dex" && zip -q -j ../base.apk classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias "$ALIAS" --ks-pass env:RFX_KS_PASS --key-pass env:RFX_KS_PASS \
  --out "$OUT/reflexity-admin.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --verbose "$OUT/reflexity-admin.apk" | head -5
echo "Built $OUT/reflexity-admin.apk (version $VERSION_NAME, code $VERSION_CODE)"
