#!/usr/bin/env bash
set -u

pkg="${1:?usage: decision-file-gate.sh <package-dir-name>}"
dest="packages/${pkg}/src/probe-decision.workflow.ts"

probe=$(ls /tmp/endgame-strangler/*/pasteback/*/"${dest}" 2>/dev/null | head -1)
if [ -z "${probe}" ]; then
  exit 0
fi

cp "${probe}" "${dest}"
out=$(pnpm --filter "@systemfsoftware/${pkg}" lint 2>&1)
rc=$?
rm -f "${dest}"
printf '%s\n' "${out}" | grep -E 'error' | head -3
exit "${rc}"
