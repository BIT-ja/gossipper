#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY=0
SKIP_FRONTEND=0
for arg in "$@"; do
  case "$arg" in
    --deploy) DEPLOY=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    -h|--help)
      echo '用法: bash scripts/build-server.sh [--skip-frontend] [--deploy]'
      echo '--deploy: 快进更新当前分支，编译，备份并替换已安装二进制，重启 gossipper'
      exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

if [ "$DEPLOY" = 1 ]; then
  [ "$(id -u)" = 0 ] || { echo '--deploy 需要 root' >&2; exit 1; }
  [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || { echo '部署仅支持 Linux x86_64' >&2; exit 1; }
  if [ "${GOSSIPPER_BUILD_UPDATED:-0}" != 1 ]; then
    # FD 9 survives exec, keeping the deployment lock across the script update.
    exec 9>/var/lock/gossipper-deploy.lock
    flock -n 9 || { echo '已有部署正在执行' >&2; exit 1; }
    [ -z "$(git status --porcelain)" ] || { echo '工作区有修改或未跟踪文件，请先处理再部署' >&2; exit 1; }
    BRANCH=$(git symbolic-ref --quiet --short HEAD) || { echo '不能部署 detached HEAD' >&2; exit 1; }
    REMOTE=$(git config --get "branch.$BRANCH.remote" || true)
    MERGE=$(git config --get "branch.$BRANCH.merge" || true)
    [ -n "$REMOTE" ] && [ "$REMOTE" != . ] && [ -n "$MERGE" ] || { echo '当前分支需要配置远程 upstream' >&2; exit 1; }
    git pull --ff-only "$REMOTE" "$MERGE"
    # Run the freshly pulled script, not the old script against new source.
    exec env GOSSIPPER_BUILD_UPDATED=1 bash scripts/build-server.sh "$@"
  fi
  unset GOSSIPPER_BUILD_UPDATED
  command -v systemctl >/dev/null
  command -v curl >/dev/null
  PYTHON=$(command -v python3 || command -v python)
  CONFIG=/etc/gossipper/gossipper.json
  test -r "$CONFIG"
  test -x /opt/gossipper/bin/gossipper
  # Keep the existing unit and configuration, but require the config-file setup.
  systemctl show gossipper -p ExecStart | grep -F -- "--config $CONFIG" >/dev/null || {
    echo "服务必须使用 --config $CONFIG；请先按部署文档更新服务单元" >&2; exit 1;
  }
  HEALTH_PORT=$("$PYTHON" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("http",{}).get("listen",":8080").rsplit(":",1)[-1])' "$CONFIG")
  [[ "$HEALTH_PORT" =~ ^[0-9]+$ ]] || { echo '无法解析 http.listen 端口' >&2; exit 1; }
fi

if ! command -v go >/dev/null; then
  for GO_DIR in /opt/go1.26.1/bin /usr/local/go/bin; do
    if [ -x "$GO_DIR/go" ]; then export PATH="$GO_DIR:$PATH"; break; fi
  done
fi
command -v go >/dev/null || { echo '未找到 Go，请安装 Go 1.26.1 或设置 PATH' >&2; exit 1; }
go version
if [ "$SKIP_FRONTEND" = 1 ]; then
  test -s internal/api/webdist/index.html || { echo '缺少预构建页面；请先构建前端'; exit 1; }
else
  (cd web/control-ui && npm ci && npm run build)
fi
mkdir -p dist
BUILD_FILE=$(mktemp "$PWD/dist/.gossipper-build.XXXXXX")
trap 'rm -f "$BUILD_FILE"' EXIT
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v1 go build -tags purego -trimpath -ldflags='-s -w' -o "$BUILD_FILE" ./cmd/gossip
chmod 0755 "$BUILD_FILE"
mv -f "$BUILD_FILE" dist/gossipper
echo '已构建 dist/gossipper (Linux x86_64)'

if [ "$DEPLOY" = 1 ]; then
  install -m 0755 dist/gossipper /opt/gossipper/bin/gossipper.next
  runuser -u gossipper -- /opt/gossipper/bin/gossipper.next ui --config "$CONFIG" --check-config
  install -d -m 0755 /var/backups
  BACKUP_DIR=$(mktemp -d "/var/backups/gossipper-deploy-$(date +%Y%m%d-%H%M%S).XXXXXX")
  cp -p /opt/gossipper/bin/gossipper "$BACKUP_DIR/gossipper"
  cp -p "$CONFIG" "$BACKUP_DIR/gossipper.json"
  systemctl cat gossipper > "$BACKUP_DIR/gossipper.service.txt"
  git rev-parse HEAD > "$BACKUP_DIR/new-revision.txt"
  echo "旧二进制和配置备份: $BACKUP_DIR"
  systemctl stop gossipper
  mv -f /opt/gossipper/bin/gossipper.next /opt/gossipper/bin/gossipper
  systemctl start gossipper
  for i in {1..30}; do
    if systemctl is-active --quiet gossipper && curl -fsS --max-time 2 "http://127.0.0.1:$HEALTH_PORT/healthz" >/dev/null; then
      echo "部署成功: $(git rev-parse --short HEAD)，健康检查通过"
      exit 0
    fi
    sleep 2
  done
  journalctl -u gossipper -n 80 --no-pager
  echo "健康检查失败，旧二进制和配置保存在 ${BACKUP_DIR}；请检查日志" >&2
  exit 1
fi
