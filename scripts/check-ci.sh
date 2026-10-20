#!/usr/bin/env bash
set -euo pipefail
check_name="${1:?Pass an npm script name}"
log_file="${RUNNER_TEMP:-/tmp}/clipsync-${check_name//:/-}.log"
set +e
npm run "$check_name" 2>&1 | tee "$log_file"
result=${PIPESTATUS[0]}
set -e
if [[ "$result" != 0 ]]; then
  CHECK_LOG_FILE="$log_file" node --input-type=module -e 'import fs from "node:fs"; const lines = fs.readFileSync(process.env.CHECK_LOG_FILE, "utf8").split(/\r?\n/).slice(-40).join("\n").slice(-3800); console.log("::error::" + lines.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A"));'
  exit "$result"
fi
