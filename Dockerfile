# Zomello Server: the web app plus the multi-user server in one small image.
#
#   docker compose up -d            (see docker-compose.yml)
#   docker build -t zomello-server .
#
# Builds for whatever machine runs the build (x86-64 PC/VPS, or arm64 like a Raspberry Pi 4/5).

# 1. The web app (the same React app the desktop version uses).
FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY public public
COPY src src
RUN npm run build

# 2. The server, with the web app built into it.
FROM rust:1-bookworm AS server
WORKDIR /src/server
COPY server/Cargo.toml server/Cargo.lock ./
# Fetch and build the dependencies first so code changes rebuild quickly.
RUN mkdir src && echo 'fn main() {}' > src/main.rs && mkdir ../dist \
    && cargo build --release --locked && rm -rf src
COPY server/src src
COPY --from=web /src/dist ../dist
RUN touch src/main.rs && cargo build --release --locked
RUN mkdir -p /out/data && cp target/release/zomello-server /out/

# 3. A tiny runtime: no shell, no package manager, runs as a non-root user.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=server /out/zomello-server /usr/local/bin/zomello-server
COPY --from=server --chown=nonroot:nonroot /out/data /data
ENV ZOMELLO_DATA=/data ZOMELLO_PORT=7311
VOLUME /data
EXPOSE 7311
HEALTHCHECK --interval=30s --timeout=6s --start-period=10s CMD ["zomello-server", "health"]
ENTRYPOINT ["zomello-server"]
