#!/usr/bin/env bash
set -euo pipefail

# Debian cloud helper: install Xvfb in a writable cache without root access.
# APT verifies signed repository metadata and package hashes before extraction.
tool_root="${CLIPSYNC_CLOUD_CACHE:-/workspace/.cache}"
if command -v Xvfb >/dev/null 2>&1 || [[ -x "$tool_root/xvfb/usr/bin/Xvfb" ]]; then
  exit 0
fi
mkdir -p "$tool_root/apt/lists/partial" "$tool_root/apt/cache/archives/partial" "$tool_root/apt/downloads" "$tool_root/xvfb"
mkdir -p "$tool_root/apt/empty.d"
cat > "$tool_root/apt/isolated.conf" <<EOF
Dir::Etc::parts "$tool_root/apt/empty.d";
Dir::Etc::main "$tool_root/apt/unused.conf";
Dir::Etc::sourcelist "$tool_root/apt/sources.list";
Dir::Etc::sourceparts "-";
Dir::State::lists "$tool_root/apt/lists";
Dir::Cache "$tool_root/apt/cache";
APT::Sandbox::User "$(id -un)";
APT::Update::Error-Mode "any";
Acquire::Languages "none";
EOF
printf '%s\n' 'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main' > "$tool_root/apt/sources.list"
export APT_CONFIG="$tool_root/apt/isolated.conf"
/usr/bin/apt-get update
cd "$tool_root/apt/downloads"
/usr/bin/apt-get download xvfb
for archive in xvfb_*.deb; do dpkg-deb --extract "$archive" "$tool_root/xvfb"; done
"$tool_root/xvfb/usr/bin/Xvfb" -help >/dev/null 2>&1
