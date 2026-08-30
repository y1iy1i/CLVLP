#!/bin/sh
set -eu

offset="${1:-0}"
case "$offset" in
  *[!0-9]*) exit 2 ;;
esac

file=/tmp/clvlp-trace.memory
size=0
if [ -f "$file" ]; then
  size=$(wc -c <"$file" | tr -d ' ')
fi

data=""
if [ "$size" -gt "$offset" ]; then
  count=$((size - offset))
  data=$(dd if="$file" bs=1 skip="$offset" count="$count" 2>/dev/null | base64 | tr -d '\n')
fi

printf 'size:%s\n' "$size"
printf 'data:%s\n' "$data"
