#!/bin/sh
set -eu

stdout_offset="${1:-0}"
stderr_offset="${2:-0}"
max_output_bytes="${3:-65536}"

case "$stdout_offset:$stderr_offset:$max_output_bytes" in
  *[!0-9:]*) exit 2 ;;
esac

emit_stream() {
  label="$1"
  file="$2"
  offset="$3"

  size=0
  if [ -f "$file" ]; then
    size=$(wc -c <"$file" | tr -d ' ')
  fi
  if [ "$size" -gt "$max_output_bytes" ]; then
    size="$max_output_bytes"
  fi

  data=""
  if [ "$size" -gt "$offset" ]; then
    count=$((size - offset))
    data=$(dd if="$file" bs=1 skip="$offset" count="$count" 2>/dev/null | base64 | tr -d '\n')
  fi

  printf '%s-size:%s\n' "$label" "$size"
  printf '%s-data:%s\n' "$label" "$data"
}

emit_stream stdout /tmp/clvlp-trace.stdout "$stdout_offset"
emit_stream stderr /tmp/clvlp-trace.stderr "$stderr_offset"
