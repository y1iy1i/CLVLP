#!/bin/sh
set -eu

exec gcc \
  -std=c11 \
  -O0 \
  -ggdb \
  -Wall \
  -Wextra \
  -pedantic \
  -fno-diagnostics-color \
  /workspace/main.c \
  -o /build/program
