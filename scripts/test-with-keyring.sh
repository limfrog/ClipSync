#!/usr/bin/env bash
set -euo pipefail
# Run under dbus-run-session. This temporary keyring contains test credentials only.
test_root="$(mktemp -d /tmp/clipsync-keyring-test-XXXXXX)"
export XDG_DATA_HOME="$test_root/data"
export XDG_RUNTIME_DIR="$test_root/runtime"
export XDG_CONFIG_HOME="$test_root/config"
mkdir -p "$XDG_DATA_HOME" "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$test_root/control"
chmod 700 "$XDG_RUNTIME_DIR"
export XDG_CURRENT_DESKTOP=GNOME
keyring_daemon="${CLIPSYNC_KEYRING_DAEMON:-gnome-keyring-daemon}"
printf '%s' 'ephemeral-test-keyring-password' | "$keyring_daemon" --foreground --unlock --components=secrets --control-directory "$test_root/control" &
keyring_pid=$!
trap 'kill "$keyring_pid" 2>/dev/null || true; wait "$keyring_pid" 2>/dev/null || true; rm -rf "$test_root"' EXIT
keyring_ready=false
for attempt in {1..50}; do
  if [[ "$(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.NameHasOwner org.freedesktop.secrets)" == *true* ]]; then keyring_ready=true; break; fi
  sleep 0.1
done
if [[ "$keyring_ready" != true ]]; then echo 'Temporary Secret Service did not become ready' >&2; exit 1; fi
"$@"
