FROM gcc:13.4.0-bookworm

RUN apt-get update \
    && apt-get install --yes --no-install-recommends gdb \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 runner \
    && useradd --uid 10001 --gid runner --no-create-home --shell /usr/sbin/nologin runner \
    && mkdir -p /build /workspace \
    && chown runner:runner /build /workspace

COPY --chmod=0555 compile-c.sh /usr/local/bin/clvlp-compile
COPY --chmod=0555 run-c.sh /usr/local/bin/clvlp-run
COPY --chmod=0555 read-trace-output.sh /usr/local/bin/clvlp-read-trace-output
COPY --chmod=0555 read-memory-events.sh /usr/local/bin/clvlp-read-memory-events
COPY --chmod=0555 read-return-events.sh /usr/local/bin/clvlp-read-return-events
COPY --chmod=0444 gdb-hooks.py /usr/local/share/clvlp-gdb-hooks.py
COPY trace-wrapper.c /tmp/clvlp-trace-wrapper.c
COPY memory-wrap.c /tmp/clvlp-memory-wrap.c

RUN gcc -std=c11 -O2 -Wall -Wextra -pedantic \
      /tmp/clvlp-trace-wrapper.c \
      -o /usr/local/bin/clvlp-trace-run \
    && chmod 0555 /usr/local/bin/clvlp-trace-run \
    && gcc -std=c11 -O0 -g -Wall -Wextra -pedantic \
      -c /tmp/clvlp-memory-wrap.c \
      -o /usr/local/lib/clvlp-memory-wrap.o \
    && chmod 0444 /usr/local/lib/clvlp-memory-wrap.o \
    && rm /tmp/clvlp-trace-wrapper.c /tmp/clvlp-memory-wrap.c

USER runner:runner
WORKDIR /workspace

CMD ["/usr/local/bin/clvlp-compile"]
