#!/bin/sh
set -u

stdout_file=/tmp/program.stdout
stderr_file=/tmp/program.stderr
run_timeout_seconds="${CLVLP_RUN_TIMEOUT_SECONDS:-2}"
max_output_bytes="${CLVLP_MAX_OUTPUT_BYTES:-65536}"

set +e
timeout --signal=KILL "${run_timeout_seconds}s" /build/program \
  </dev/null >"$stdout_file" 2>"$stderr_file"
status=$?
set -e

head -c "$max_output_bytes" "$stdout_file"
head -c "$max_output_bytes" "$stderr_file" >&2

if [ "$status" -eq 137 ]; then
  status=124
fi

exit "$status"
