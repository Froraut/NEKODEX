#!/bin/sh
set -eu

REPOSITORY="${CODEX_CHATGPT_WEB_REPOSITORY:-Froraut/NEKODEX}"
VERSION="${CODEX_CHATGPT_WEB_VERSION:-6.0.0-nekodex.1}"
BIN_DIR="${CODEX_CHATGPT_WEB_BIN_DIR:-$HOME/.local/bin}"
LIB_DIR="${CODEX_CHATGPT_WEB_LIB_DIR:-$HOME/.local/lib/codex-chatgpt-web}"
DOC_DIR="${CODEX_CHATGPT_WEB_DOC_DIR:-$HOME/.local/share/doc/codex-chatgpt-web}"
TRUSTED_REPOSITORY="Froraut/NEKODEX"

# Caller settings select a version and destinations, never a new publisher.
if [ "$REPOSITORY" != "$TRUSTED_REPOSITORY" ]; then
  echo "The standalone installer trusts releases from $TRUSTED_REPOSITORY only" >&2
  exit 1
fi
if ! printf '%s\n' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9]+([.-][A-Za-z0-9]+)*)?$'; then
  echo "Invalid release version" >&2
  exit 1
fi
if [ "$(uname -s)" != "Darwin" ]; then
  echo "The terminal-only installer supports macOS only; use the desktop launcher on Windows or Linux" >&2
  exit 1
fi
case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="amd64" ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac

# Verification must use an already trusted local runtime, never the download.
if ! NODE="$(command -v node)"; then
  echo "Authenticated terminal installation requires a preinstalled Node.js runtime; no downloaded executable will be run as a verifier" >&2
  exit 1
fi
"$NODE" -e 'require("node:crypto"); require("node:fs")'

ASSET="codex-chatgpt-web-darwin-$ARCH.tar.gz"
BASE_URL="https://github.com/$TRUSTED_REPOSITORY/releases/download/v$VERSION"
PREVIOUS_UMASK="$(umask)"
umask 077
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-chatgpt-web.XXXXXX")"
umask "$PREVIOUS_UMASK"
LIB_STAGE_ROOT=""
BIN_STAGE_ROOT=""
DOC_STAGE_ROOT=""
TARGET_DIR=""
COMMITTED=0
RUNTIME_REPLACEMENT_STARTED=0
COMMAND_REPLACEMENT_STARTED=0

cleanup() {
  status="$?"
  trap - EXIT HUP INT TERM
  set +e
  if [ "$COMMITTED" -ne 1 ]; then
    if [ -n "$LIB_STAGE_ROOT" ] && [ -e "$LIB_STAGE_ROOT/previous" ]; then
      rm -rf -- "$TARGET_DIR"
      if ! mv "$LIB_STAGE_ROOT/previous" "$TARGET_DIR"; then
        echo "Could not restore the previous runtime; it remains at $LIB_STAGE_ROOT/previous" >&2
        LIB_STAGE_ROOT=""
      fi
    elif [ "$RUNTIME_REPLACEMENT_STARTED" -eq 1 ]; then
      rm -rf -- "$TARGET_DIR"
    fi
    if [ -n "$BIN_STAGE_ROOT" ]; then
      if [ -e "$BIN_STAGE_ROOT/previous" ] || [ -L "$BIN_STAGE_ROOT/previous" ]; then
        rm -f -- "$BIN_DIR/codex-chatgpt-web"
        if ! mv "$BIN_STAGE_ROOT/previous" "$BIN_DIR/codex-chatgpt-web"; then
          echo "Could not restore the previous command; it remains at $BIN_STAGE_ROOT/previous" >&2
          BIN_STAGE_ROOT=""
        fi
      elif [ "$COMMAND_REPLACEMENT_STARTED" -eq 1 ]; then
        rm -f -- "$BIN_DIR/codex-chatgpt-web"
      fi
    fi
    if [ -n "$DOC_STAGE_ROOT" ]; then
      doc_recovery_failed=0
      for DOC in LICENSE Bun-1.4.0.md THIRD_PARTY_NOTICES.txt; do
        if [ -e "$DOC_STAGE_ROOT/$DOC.previous" ] || [ -L "$DOC_STAGE_ROOT/$DOC.previous" ]; then
          rm -f -- "$DOC_DIR/$DOC"
          if ! mv "$DOC_STAGE_ROOT/$DOC.previous" "$DOC_DIR/$DOC"; then
            echo "Could not restore $DOC; it remains at $DOC_STAGE_ROOT/$DOC.previous" >&2
            doc_recovery_failed=1
          fi
        elif [ -f "$DOC_STAGE_ROOT/$DOC.replacing" ]; then
          rm -f -- "$DOC_DIR/$DOC"
        fi
      done
      if [ "$doc_recovery_failed" -eq 1 ]; then DOC_STAGE_ROOT=""; fi
    fi
  fi
  for directory in "$LIB_STAGE_ROOT" "$BIN_STAGE_ROOT" "$DOC_STAGE_ROOT"; do
    if [ -n "$directory" ]; then rm -rf -- "$directory"; fi
  done
  rm -rf -- "$TEMP_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# The transfer and parser both bound metadata. All downloads stay in a private
# temporary directory; no install destination is touched until every file verifies.
curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 60 --max-filesize 524288 \
  "$BASE_URL/release-metadata.json" -o "$TEMP_DIR/release-metadata.json"
curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 900 --max-filesize 1073741824 \
  "$BASE_URL/$ASSET" -o "$TEMP_DIR/$ASSET"
for DOC in LICENSE Bun-1.4.0.md THIRD_PARTY_NOTICES.txt; do
  curl -fsSL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 60 --max-filesize 1073741824 \
    "$BASE_URL/$DOC" -o "$TEMP_DIR/$DOC"
done

# Standalone copy of the launcher's packaged Ed25519 verifier. A checksum file
# downloaded beside an archive is not publisher authentication.
"$NODE" - "$TEMP_DIR/release-metadata.json" "$TEMP_DIR" "$VERSION" \
  "$ASSET" LICENSE Bun-1.4.0.md THIRD_PARTY_NOTICES.txt <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");

const [metadataPath, directory, version, ...assetNames] = process.argv.slice(2);
const path = require("node:path");
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

const metadataInfo = fs.lstatSync(metadataPath);
if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink() || metadataInfo.size > 512 * 1024) fail("Release metadata exceeds its limit or is not a regular file");
const raw = fs.readFileSync(metadataPath);
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
const names = new Set();
for (const entry of payload.assets) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(entry?.name || "") || entry.name === "release-metadata.json"
    || names.has(entry.name) || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 1024 ** 3
    || !/^[a-f0-9]{64}$/.test(entry.sha256 || "")) fail("Invalid or duplicate signed release asset");
  names.add(entry.name);
}
for (const assetName of assetNames) {
  const assetPath = path.join(directory, assetName);
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
}
NODE

mkdir -p "$LIB_DIR" "$BIN_DIR" "$DOC_DIR"
# Resolve caller-provided relative paths before using them in the command symlink.
LIB_DIR="$(CDPATH= cd -- "$LIB_DIR" && pwd -P)"
BIN_DIR="$(CDPATH= cd -- "$BIN_DIR" && pwd -P)"
DOC_DIR="$(CDPATH= cd -- "$DOC_DIR" && pwd -P)"
TARGET_DIR="$LIB_DIR/$VERSION"
if [ -L "$TARGET_DIR" ] || { [ -e "$TARGET_DIR" ] && [ ! -d "$TARGET_DIR" ]; }; then
  echo "Refusing to replace a runtime target that is not a regular directory" >&2
  exit 1
fi
for file in "$BIN_DIR/codex-chatgpt-web" "$DOC_DIR/LICENSE" "$DOC_DIR/Bun-1.4.0.md" "$DOC_DIR/THIRD_PARTY_NOTICES.txt"; do
  if [ -d "$file" ] && [ ! -L "$file" ]; then
    echo "Refusing to replace a directory with an installed file: $file" >&2
    exit 1
  fi
done
LIB_STAGE_ROOT="$(mktemp -d "$LIB_DIR/.install-$VERSION.XXXXXX")"
BIN_STAGE_ROOT="$(mktemp -d "$BIN_DIR/.nekodex-install.XXXXXX")"
DOC_STAGE_ROOT="$(mktemp -d "$DOC_DIR/.nekodex-install.XXXXXX")"
STAGE_DIR="$LIB_STAGE_ROOT/runtime"
mkdir "$STAGE_DIR"
tar -xzf "$TEMP_DIR/$ASSET" -C "$STAGE_DIR"
if [ ! -x "$STAGE_DIR/bin/codex-chatgpt-web" ] || [ ! -x "$STAGE_DIR/runtime/bun" ]; then
  echo "Runtime archive is incomplete" >&2
  exit 1
fi
if [ "$("$STAGE_DIR/bin/codex-chatgpt-web" --version)" != "$VERSION" ]; then
  echo "Runtime archive version does not match $VERSION" >&2
  exit 1
fi
ln -s "$TARGET_DIR/bin/codex-chatgpt-web" "$BIN_STAGE_ROOT/next"
for DOC in LICENSE Bun-1.4.0.md THIRD_PARTY_NOTICES.txt; do
  install -m 0644 "$TEMP_DIR/$DOC" "$DOC_STAGE_ROOT/$DOC.next"
done

# Keep each previous path until the complete runtime/command/notices transaction
# commits. A failed replacement restores existing files, including command links.
if [ -e "$TARGET_DIR" ]; then mv "$TARGET_DIR" "$LIB_STAGE_ROOT/previous"; fi
RUNTIME_REPLACEMENT_STARTED=1
mv "$STAGE_DIR" "$TARGET_DIR"
if [ -e "$BIN_DIR/codex-chatgpt-web" ] || [ -L "$BIN_DIR/codex-chatgpt-web" ]; then
  mv "$BIN_DIR/codex-chatgpt-web" "$BIN_STAGE_ROOT/previous"
fi
COMMAND_REPLACEMENT_STARTED=1
mv "$BIN_STAGE_ROOT/next" "$BIN_DIR/codex-chatgpt-web"
for DOC in LICENSE Bun-1.4.0.md THIRD_PARTY_NOTICES.txt; do
  if [ -e "$DOC_DIR/$DOC" ] || [ -L "$DOC_DIR/$DOC" ]; then
    mv "$DOC_DIR/$DOC" "$DOC_STAGE_ROOT/$DOC.previous"
  fi
  touch "$DOC_STAGE_ROOT/$DOC.replacing"
  mv "$DOC_STAGE_ROOT/$DOC.next" "$DOC_DIR/$DOC"
done
COMMITTED=1
rm -f "$BIN_DIR/codex-chatgpt-web.legacy-standalone"

echo "Installed $TARGET_DIR"
if [ "$#" -gt 0 ]; then
  "$TARGET_DIR/bin/codex-chatgpt-web" setup "$@"
  exit 0
fi
echo "Next: $BIN_DIR/codex-chatgpt-web setup --browser-only --acknowledge-unofficial"
