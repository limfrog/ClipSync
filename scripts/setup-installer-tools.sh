#!/usr/bin/env bash
set -euo pipefail
tools_root="${CLIPSYNC_INSTALLER_TOOLS:-/workspace/.cache/clipsync-installer-tools}"
mkdir -p "$tools_root/rcodesign"
rcodesign_dir="$tools_root/rcodesign/apple-codesign-0.29.0-x86_64-unknown-linux-musl"
if [[ ! -x "$rcodesign_dir/rcodesign" ]]; then
  curl -fSL --retry 2 'https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F0.29.0/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz' -o "$tools_root/rcodesign/rcodesign.tar.gz"
  python3 - "$tools_root/rcodesign" <<'PY'
import hashlib, pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
archive = root / 'rcodesign.tar.gz'
expected = 'dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, 'rcodesign checksum mismatch'
with tarfile.open(archive) as stream:
    stream.extractall(root, filter='data')
PY
fi
if [[ ! -d "$tools_root/bomutils/.git" ]]; then
  git clone --no-checkout https://github.com/hogliux/bomutils.git "$tools_root/bomutils"
  git -C "$tools_root/bomutils" checkout --detach c247002e2f49878bab32dd0fcf805810ae0992cb
fi
test "$(git -C "$tools_root/bomutils" rev-parse HEAD)" = c247002e2f49878bab32dd0fcf805810ae0992cb
make -C "$tools_root/bomutils" -j2 all
"$rcodesign_dir/rcodesign" --version
