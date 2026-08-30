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
  /usr/local/lib/clvlp-memory-wrap.o \
  -Wl,--wrap=malloc \
  -Wl,--wrap=calloc \
  -Wl,--wrap=realloc \
  -Wl,--wrap=free \
  -o /build/program
