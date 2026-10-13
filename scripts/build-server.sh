#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  --skip-frontend)
    test -s internal/api/webdist/index.html || { echo '缺少预构建页面；请使用包含页面的源码包或先构建前端'; exit 1; }
    ;;
  '') (cd web/control-ui && npm ci && npm run build) ;;
  *) echo '用法: bash scripts/build-server.sh [--skip-frontend]'; exit 1 ;;
esac
mkdir -p dist
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v1 go build -tags purego -trimpath -ldflags='-s -w' -o dist/gossipper ./cmd/gossip
echo '已构建 dist/gossipper (Linux x86_64)'
