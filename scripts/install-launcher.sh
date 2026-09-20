#!/bin/sh
set -eu

REPOSITORY="${CODEX_WEB_GPT_REPOSITORY:-Froraut/NEKODEX}"
VERSION="${CODEX_WEB_GPT_VERSION:-}"
OS="$(uname -s)"
MACHINE="$(uname -m)"
TRUSTED_REPOSITORY="Froraut/NEKODEX"
TRUSTED_APPLE_TEAM_ID="CNMWGJF2CG"
TRUSTED_MACOS_BUNDLE_ID="dev.codexwebgpt.launcher"

if ! printf '%s\n' "$REPOSITORY" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
  echo "Invalid GitHub repository: $REPOSITORY" >&2
  exit 1
fi
if [ "$REPOSITORY" != "$TRUSTED_REPOSITORY" ]; then
  echo "The standalone installer trusts releases from $TRUSTED_REPOSITORY only" >&2
  exit 1
fi

case "$OS" in
  Darwin)
    PLATFORM="mac"
    EXTENSION="zip"
    case "$MACHINE" in
      arm64|aarch64) ARCH="arm64" ;;
      x86_64|amd64) ARCH="x64" ;;
      *) echo "Unsupported macOS architecture: $MACHINE" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    PLATFORM="linux"
    EXTENSION="AppImage"
    case "$MACHINE" in
      x86_64|amd64) ARCH="x64" ;;
      *) echo "The packaged Linux launcher currently supports x86_64; detected $MACHINE" >&2; exit 1 ;;
    esac
    ;;
  *) echo "Use install-launcher.ps1 on Windows; unsupported OS: $OS" >&2; exit 1 ;;
esac

if [ "$OS" = "Linux" ] && ! command -v node >/dev/null 2>&1; then
  echo "Authenticated Linux installation requires a preinstalled Node.js runtime to verify NEKODEX release-metadata.json; no downloaded executable will be run as a verifier" >&2
  exit 1
fi

# NEKODEX distributes prereleases. Inspect a bounded published list for an exact
# platform asset; keep the existing checksum download and SHA-256 gate below.
if [ -z "$VERSION" ]; then
  RELEASES="$(curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 60 \
    "https://api.github.com/repos/$REPOSITORY/releases?per_page=10")"
  VERSION="$(printf '%s\n' "$RELEASES" | awk -v platform="$PLATFORM" -v arch="$ARCH" -v extension="$EXTENSION" '
    # Walk JSON tokens so asset names cannot be confused with release metadata
    # or nested author/upload objects. The API response is bounded to 10 releases.
    function value(s, d) {
      if (d == 2 && kind[d] == "release" && key[d] == "tag_name") {
        tag = s
        if (substr(tag, 1, 1) == "v") tag = substr(tag, 2)
        valid = tag ~ /^[A-Za-z0-9][A-Za-z0-9._-]*$/
      } else if (d == 4 && kind[d] == "asset" && key[d] == "name") {
        names[++count] = s
      }
      if (d > 0) key[d] = ""
    }
    {
      json = json $0 "\n"
    }
    END {
      depth = 0
      for (i = 1; i <= length(json); i++) {
        c = substr(json, i, 1)
        if (c ~ /[ \t\r\n]/) continue
        if (c == "\"") {
          s = ""
          for (i++; i <= length(json); i++) {
            c = substr(json, i, 1)
            if (c == "\\") { i++; s = s substr(json, i, 1); continue }
            if (c == "\"") break
            s = s c
          }
          j = i + 1
          while (substr(json, j, 1) ~ /[ \t\r\n]/) j++
          if (substr(json, j, 1) == ":") key[depth] = s
          else value(s, depth)
        } else if (c == "{" || c == "[") {
          parent = kind[depth]
          field = key[depth]
          depth++
          if (depth == 1 && c == "[") kind[depth] = "root"
          else if (depth == 2 && parent == "root" && c == "{") {
            kind[depth] = "release"; tag = ""; valid = 0; count = 0
          } else if (depth == 3 && parent == "release" && field == "assets" && c == "[") kind[depth] = "assets"
          else if (depth == 4 && parent == "assets" && c == "{") kind[depth] = "asset"
          else kind[depth] = "other"
          key[depth] = ""
          if (depth > 1) key[depth - 1] = ""
        } else if (c == "}" || c == "]") {
          if (depth == 2 && kind[depth] == "release" && valid && !selected) {
            expected = "codex-web-gpt-" tag "-" platform "-" arch "." extension
            for (n = 1; n <= count; n++) {
              if (names[n] == expected) { selected = tag; break }
            }
          }
          delete kind[depth]; delete key[depth]; depth--
        } else if (c == ",") {
          if (depth > 0) key[depth] = ""
        } else if (c != ":") {
          j = i
          while (j <= length(json) && index(",}] \t\r\n", substr(json, j, 1)) == 0) j++
          i = j - 1
          if (depth > 0) key[depth] = ""
        }
      }
      if (selected) print selected
    }
  ')"
  if [ -z "$VERSION" ]; then
    echo "No published NEKODEX release among the newest 10 has a $PLATFORM-$ARCH.$EXTENSION asset; set CODEX_WEB_GPT_VERSION explicitly" >&2
    exit 1
  fi
fi
VERSION="${VERSION#v}"
if [ -z "$VERSION" ]; then
  echo "Could not resolve a published NEKODEX release; set CODEX_WEB_GPT_VERSION explicitly" >&2
  exit 1
fi
case "$VERSION" in
  *[!A-Za-z0-9._-]*) echo "Invalid release version: $VERSION" >&2; exit 1 ;;
esac

ASSET="codex-web-gpt-$VERSION-$PLATFORM-$ARCH.$EXTENSION"
BASE_URL="https://github.com/$REPOSITORY/releases/download/v$VERSION"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-web-gpt-launcher.XXXXXX")"
MAC_STAGE_ROOT=""
MAC_TARGET_APP=""
MAC_BACKUP_APP=""
MAC_REPLACEMENT_STARTED=0
MAC_COMMITTED=0

cleanup() {
  status="$?"
  trap - EXIT HUP INT TERM
  set +e
  if [ "$MAC_COMMITTED" -ne 1 ]; then
    if [ -n "$MAC_BACKUP_APP" ] && [ -e "$MAC_BACKUP_APP" ]; then
      if [ -n "$MAC_TARGET_APP" ] && [ -e "$MAC_TARGET_APP" ]; then rm -rf -- "$MAC_TARGET_APP"; fi
      if ! mv "$MAC_BACKUP_APP" "$MAC_TARGET_APP"; then
        echo "Could not restore the previous NEKODEX app; it remains at $MAC_BACKUP_APP" >&2
      fi
    elif [ "$MAC_REPLACEMENT_STARTED" -eq 1 ] && [ -n "$MAC_TARGET_APP" ]; then
      rm -rf -- "$MAC_TARGET_APP"
    fi
  fi
  if [ -n "$MAC_STAGE_ROOT" ] && [ -d "$MAC_STAGE_ROOT" ]; then rm -rf -- "$MAC_STAGE_ROOT"; fi
  rm -rf -- "$TEMP_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 900 \
  "$BASE_URL/$ASSET" -o "$TEMP_DIR/$ASSET"
curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 60 \
  "$BASE_URL/checksums.txt" -o "$TEMP_DIR/checksums.txt"
EXPECTED="$(awk -v asset="$ASSET" '$2 == asset { print $1 }' "$TEMP_DIR/checksums.txt")"
if [ "$OS" = "Darwin" ]; then
  ACTUAL="$(shasum -a 256 "$TEMP_DIR/$ASSET" | awk '{ print $1}')"
else
  ACTUAL="$(sha256sum "$TEMP_DIR/$ASSET" | awk '{ print $1}')"
fi
if [ -z "$EXPECTED" ]; then
  echo "checksums.txt has no entry for $ASSET" >&2
  exit 1
fi
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "SHA-256 verification failed for $ASSET" >&2
  exit 1
fi

verify_signed_release_metadata() {
  metadata="$TEMP_DIR/release-metadata.json"
  curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 60 \
    "$BASE_URL/release-metadata.json" -o "$metadata"
  node - "$metadata" "$TEMP_DIR/$ASSET" "$ASSET" "$VERSION" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");

const [metadataPath, assetPath, assetName, version] = process.argv.slice(2);
const repository = "Froraut/NEKODEX";
const keyId = "2175d07bb3fdb619aba59b9739d346ca4354a4fa6b81b1f76edaaa3256c4f048";
const publicKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEACJiU70zrWLssiLbR+hPV9OB6/nbQi14qegzMYI5QUIE=
-----END PUBLIC KEY-----
`;
const keyNotBefore = Date.parse("2026-09-11T19:04:10.618Z");
const keyNotAfter = Date.parse("2031-09-11T19:09:10.618Z");
const domain = Buffer.from("codex-web-gpt.release.v1\0", "utf8");
const now = Date.now();
const fail = (message) => { throw new Error(message); };
const decodeBase64 = (value, limit, label) => {
  if (typeof value !== "string" || value.length > Math.ceil(limit / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(`Invalid ${label}`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.length > limit || decoded.toString("base64") !== value) fail(`Invalid ${label}`);
  return decoded;
};
const parseTimestamp = (value, label) => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail(`Invalid ${label}`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(`Invalid ${label}`);
  return parsed;
};

const parsedPublicKey = crypto.createPublicKey(publicKey);
const actualKeyId = crypto.createHash("sha256").update(parsedPublicKey.export({ type: "spki", format: "der" })).digest("hex");
if (parsedPublicKey.asymmetricKeyType !== "ed25519" || actualKeyId !== keyId) fail("Packaged NEKODEX release trust key is invalid");

const raw = fs.readFileSync(metadataPath);
if (raw.length > 512 * 1024) fail("Release metadata exceeds its limit");
const envelope = JSON.parse(raw.toString("utf8"));
if (envelope?.schemaVersion !== 1 || !Array.isArray(envelope.signatures) || envelope.signatures.length < 1 || envelope.signatures.length > 16) {
  fail("Invalid signed release metadata envelope");
}
const payloadBytes = decodeBase64(envelope.payload, 512 * 1024, "release metadata payload");
const signatures = envelope.signatures.filter(entry => entry?.keyId === keyId);
if (signatures.length !== 1) fail("Release metadata does not contain exactly one trusted publisher signature");
const signature = decodeBase64(signatures[0].signature, 64, "release metadata signature");
if (signature.length !== 64 || !crypto.verify(null, Buffer.concat([domain, payloadBytes]), parsedPublicKey, signature)) {
  fail("Release metadata signature does not match the packaged NEKODEX trust key");
}
const payload = JSON.parse(payloadBytes.toString("utf8"));
if (payload?.schemaVersion !== 1 || payload.repository !== repository || payload.tag !== `v${version}` || payload.version !== version) {
  fail("Signed release identity does not match the requested NEKODEX version");
}
const issuedAt = parseTimestamp(payload.issuedAt, "release issuedAt");
const expiresAt = parseTimestamp(payload.expiresAt, "release expiresAt");
if (now < keyNotBefore || now >= keyNotAfter || issuedAt < keyNotBefore || issuedAt >= keyNotAfter
  || issuedAt > now + 5 * 60 * 1000 || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > 180 * 86400000) {
  fail("Signed release metadata or publisher key is outside its validity interval");
}
if (!/^[a-f0-9]{40}$/.test(payload.source?.commit || "") || !/^\d+$/.test(payload.source?.runId || "")
  || payload.source?.workflow !== ".github/workflows/release.yml" || payload.source?.buildType !== "github-actions" || payload.source.runId === "0") {
  fail("Signed release provenance is not a published GitHub Actions release");
}
if (!Array.isArray(payload.assets) || payload.assets.length < 1 || payload.assets.length > 256) fail("Invalid signed release asset list");
const matches = payload.assets.filter(entry => entry?.name === assetName);
if (matches.length !== 1 || !Number.isSafeInteger(matches[0].size) || matches[0].size < 1 || matches[0].size > 1024 ** 3
  || !/^[a-f0-9]{64}$/.test(matches[0].sha256 || "")) fail("Asset is absent or invalid in signed release metadata");
const info = fs.lstatSync(assetPath);
if (!info.isFile() || info.isSymbolicLink() || info.size !== matches[0].size) fail("Authenticated release asset size mismatch");
const digest = crypto.createHash("sha256");
const descriptor = fs.openSync(assetPath, "r");
const chunk = Buffer.allocUnsafe(1024 * 1024);
try {
  for (;;) {
    const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
    if (count === 0) break;
    digest.update(chunk.subarray(0, count));
  }
} finally {
  fs.closeSync(descriptor);
}
const actual = digest.digest("hex");
if (actual !== matches[0].sha256) fail("Authenticated release asset checksum mismatch");
NODE
}

verify_macos_publisher() {
  app="$1"
  details="$TEMP_DIR/codesign-details.txt"
  codesign --verify --deep --strict "$app"
  codesign --display --verbose=4 "$app" >"$details" 2>&1
  grep -Fqx "Identifier=$TRUSTED_MACOS_BUNDLE_ID" "$details" \
    || { echo "macOS app bundle identity does not match NEKODEX" >&2; exit 1; }
  grep -Fqx "TeamIdentifier=$TRUSTED_APPLE_TEAM_ID" "$details" \
    || { echo "macOS publisher team does not match NEKODEX" >&2; exit 1; }
  grep -Eq "^Authority=Developer ID Application: .+ \\($TRUSTED_APPLE_TEAM_ID\\)$" "$details" \
    || { echo "macOS app is not signed by the expected NEKODEX Developer ID identity" >&2; exit 1; }
  grep -Eq '^Timestamp=.+' "$details" \
    || { echo "macOS app signature has no secure timestamp" >&2; exit 1; }
  spctl --assess --type execute "$app"
  bun="$app/Contents/Resources/runtime/runtime/bun"
  if [ ! -x "$bun" ]; then
    echo "Packaged NEKODEX runtime is missing its executable" >&2
    exit 1
  fi
  codesign --verify --strict "$bun"
  codesign --display --verbose=4 "$bun" >"$details" 2>&1
  grep -Fqx "TeamIdentifier=$TRUSTED_APPLE_TEAM_ID" "$details" \
    || { echo "Bundled runtime publisher team does not match NEKODEX" >&2; exit 1; }
}

if [ "$OS" = "Linux" ]; then
  verify_signed_release_metadata
fi

if [ "$OS" = "Darwin" ]; then
  INSTALL_DIR="${CODEX_WEB_GPT_APPLICATIONS_DIR:-/Applications}"
  STAGE_DIR="$TEMP_DIR/stage"
  mkdir "$STAGE_DIR"
  ditto -x -k "$TEMP_DIR/$ASSET" "$STAGE_DIR"
  SOURCE_APP="$STAGE_DIR/NEKODEX.app"
  if [ ! -d "$SOURCE_APP" ] || [ ! -x "$SOURCE_APP/Contents/MacOS/NEKODEX" ]; then
    echo "Launcher archive is incomplete" >&2
    exit 1
  fi
  verify_macos_publisher "$SOURCE_APP"
  if [ ! -w "$INSTALL_DIR" ]; then
    INSTALL_DIR="$HOME/Applications"
    mkdir -p "$INSTALL_DIR"
  fi
  case "$INSTALL_DIR" in
    /*) ;;
    *) echo "Application install directory must be absolute" >&2; exit 1 ;;
  esac
  INSTALL_DIR="$(CDPATH= cd -- "$INSTALL_DIR" && pwd -P)"
  if [ "$INSTALL_DIR" = "/" ]; then
    echo "Refusing to use the filesystem root as the application install directory" >&2
    exit 1
  fi
  MAC_TARGET_APP="$INSTALL_DIR/NEKODEX.app"
  TARGET_APP="$MAC_TARGET_APP"
  if pgrep -x "NEKODEX" >/dev/null 2>&1 || pgrep -x "Codex Web GPT" >/dev/null 2>&1; then
    echo "Quit NEKODEX before updating it" >&2
    exit 1
  fi
  if [ -L "$TARGET_APP" ]; then
    echo "Refusing to replace a symbolic-link application target: $TARGET_APP" >&2
    exit 1
  fi
  MAC_STAGE_ROOT="$(mktemp -d "$INSTALL_DIR/.nekodex-install.XXXXXX")"
  STAGED_APP="$MAC_STAGE_ROOT/NEKODEX.app"
  ditto "$SOURCE_APP" "$STAGED_APP"
  verify_macos_publisher "$STAGED_APP"
  STAGED_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$STAGED_APP/Contents/Info.plist")"
  if [ "$STAGED_VERSION" != "$VERSION" ]; then
    echo "Packaged NEKODEX version $STAGED_VERSION does not match requested version $VERSION" >&2
    exit 1
  fi
  MAC_BACKUP_APP="$INSTALL_DIR/.NEKODEX.previous.$$"
  if [ -e "$MAC_BACKUP_APP" ] || [ -L "$MAC_BACKUP_APP" ]; then
    echo "Refusing to overwrite an existing recovery app: $MAC_BACKUP_APP" >&2
    exit 1
  fi
  if [ -e "$TARGET_APP" ]; then mv "$TARGET_APP" "$MAC_BACKUP_APP"; fi
  MAC_REPLACEMENT_STARTED=1
  mv "$STAGED_APP" "$TARGET_APP"
  verify_macos_publisher "$TARGET_APP"
  INSTALLED_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TARGET_APP/Contents/Info.plist")"
  if [ "$INSTALLED_VERSION" != "$VERSION" ]; then
    echo "Installed NEKODEX version does not match requested version $VERSION" >&2
    exit 1
  fi
  MAC_COMMITTED=1
  if [ -e "$MAC_BACKUP_APP" ]; then rm -rf -- "$MAC_BACKUP_APP"; fi
  echo "Installed $TARGET_APP"
  open "$TARGET_APP"
  exit 0
fi

LIB_DIR="${CODEX_WEB_GPT_LIB_DIR:-$HOME/.local/lib/codex-web-gpt}"
BIN_DIR="${CODEX_WEB_GPT_BIN_DIR:-$HOME/.local/bin}"
TARGET_DIR="$LIB_DIR/$VERSION"
TARGET="$TARGET_DIR/NEKODEX.AppImage"
WRAPPER="$BIN_DIR/codex-web-gpt"
CORE_HOME="${CODEX_CHATGPT_WEB_HOME:-$HOME/.codex-chatgpt-web}"
DESCRIPTOR="$CORE_HOME/runtime/launcher-browser.json"
RUNNING_PID=""
if [ -f "$DESCRIPTOR" ]; then
  RUNNING_PID="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$DESCRIPTOR" | head -n 1)"
fi
if { [ -n "$RUNNING_PID" ] && kill -0 "$RUNNING_PID" 2>/dev/null; } \
  || pgrep -f "NEKODEX\\.AppImage" >/dev/null 2>&1; then
  echo "Quit NEKODEX before updating it" >&2
  exit 1
fi
EXTRACT_DIR="$TEMP_DIR/appimage"
mkdir -p "$EXTRACT_DIR"
chmod 0755 "$TEMP_DIR/$ASSET"
(
  cd "$EXTRACT_DIR"
  "$TEMP_DIR/$ASSET" --appimage-extract >/dev/null
)
ICON_SOURCE="$(find "$EXTRACT_DIR/squashfs-root" -type f -path '*/512x512/*' -name '*.png' | sort | head -n 1)"
if [ -z "$ICON_SOURCE" ]; then
  ICON_SOURCE="$(find "$EXTRACT_DIR/squashfs-root" -type f -name '*.png' | sort | head -n 1)"
fi
if [ -z "$ICON_SOURCE" ]; then
  echo "Launcher AppImage does not contain a PNG application icon" >&2
  exit 1
fi
RUNNER_SOURCE="$(find "$EXTRACT_DIR/squashfs-root" -type f -path '*/app.asar.unpacked/assets/linux-appimage-runner.sh' -print -quit)"
if [ -z "$RUNNER_SOURCE" ]; then
  echo "Launcher AppImage does not contain its bounded Linux runner" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR" "$BIN_DIR"
TARGET_NEXT="$TARGET.next.$$"
WRAPPER_NEXT="$WRAPPER.next.$$"
RUNNER="$LIB_DIR/run-appimage"
RUNNER_NEXT="$RUNNER.next.$$"
trap 'rm -rf "$TEMP_DIR"; rm -f "$TARGET_NEXT" "$WRAPPER_NEXT" "$RUNNER_NEXT"' EXIT HUP INT TERM
install -m 0755 "$TEMP_DIR/$ASSET" "$TARGET_NEXT"
mv -f "$TARGET_NEXT" "$TARGET"
install -m 0755 "$RUNNER_SOURCE" "$RUNNER_NEXT"
mv -f "$RUNNER_NEXT" "$RUNNER"
shell_quote() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}
WRAPPER_QUOTED="$(shell_quote "$WRAPPER")"
TARGET_QUOTED="$(shell_quote "$TARGET")"
RUNNER_QUOTED="$(shell_quote "$RUNNER")"
{
  printf '%s\n' '#!/bin/sh'
  printf '%s\n' 'set -eu'
  printf 'export CODEX_WEB_GPT_LAUNCHER_EXECUTABLE=%s\n' "$WRAPPER_QUOTED"
  printf 'export CODEX_WEB_GPT_APPIMAGE=%s\n' "$TARGET_QUOTED"
  printf 'exec %s %s "$@"\n' "$RUNNER_QUOTED" "$TARGET_QUOTED"
} > "$WRAPPER_NEXT"
chmod 0755 "$WRAPPER_NEXT"
mv -f "$WRAPPER_NEXT" "$WRAPPER"

APPLICATIONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"
mkdir -p "$APPLICATIONS_DIR" "$ICON_DIR"
install -m 0644 "$ICON_SOURCE" "$ICON_DIR/codex-web-gpt.png"
DESKTOP_WRAPPER="$(printf '%s' "$WRAPPER" | sed \
  -e 's/\\/\\\\/g' \
  -e 's/"/\\"/g' \
  -e 's/`/\\`/g' \
  -e 's/\$/\\$/g' \
  -e 's/%/%%/g')"
cat > "$APPLICATIONS_DIR/codex-web-gpt.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=NEKODEX
Comment=ChatGPT Web models inside the native Codex harness
Exec="$DESKTOP_WRAPPER"
Icon=codex-web-gpt
Terminal=false
Categories=Development;
StartupWMClass=codex-web-gpt
EOF
chmod 0644 "$APPLICATIONS_DIR/codex-web-gpt.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi
echo "Installed $TARGET"
nohup "$WRAPPER" >/dev/null 2>&1 &
