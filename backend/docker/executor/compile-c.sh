#!/bin/sh
set -eu

exec gcc \
  -std=c11 \
  -O0 \
  -g \
  -Wall \
  -Wextra \
  -pedantic \
  -fno-diagnostics-color \
  /workspace/main.c \
  -o /build/program
