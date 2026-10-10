# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS web
WORKDIR /src/web/control-ui
COPY web/control-ui/package*.json ./
RUN npm ci
COPY web/control-ui/ ./
RUN npm run build

FROM golang:1.26.1-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/internal/api/webdist/ ./internal/api/webdist/
RUN CGO_ENABLED=0 go build -tags purego -trimpath -ldflags='-s -w' -o /out/gossipper ./cmd/gossip

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home gossipper \
    && mkdir -p /var/lib/gossipper && chown gossipper:gossipper /var/lib/gossipper
COPY --from=build /out/gossipper /usr/local/bin/gossipper
ENV TZ=Asia/Shanghai
USER 10001:10001
WORKDIR /var/lib/gossipper
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["gossipper"]
CMD ["ui", "--data-dir", "/var/lib/gossipper", "--listen", ":8080"]
