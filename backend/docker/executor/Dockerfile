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

USER runner:runner
WORKDIR /workspace

CMD ["/usr/local/bin/clvlp-compile"]
