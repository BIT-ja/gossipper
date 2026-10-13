# 使用仓库中的预构建页面

main 和 centos7 分支跟踪 internal/api/webdist 的 HTML、JavaScript、CSS 和字体文件。服务器拉取分支后无需另外上传页面包，也不需要 Node 即可编译带页面的程序。

centos7 分支（Go 1.26.1+）：

```sh
bash scripts/build-server.sh --skip-frontend
```

两个分支均可使用通用命令：

```sh
mkdir -p dist
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v1 \
  go build -tags purego -trimpath -o dist/gossipper ./cmd/gossip
```

页面产物与各自分支的前端源码对应；此调整不会将 centos7 的 MySQL 等后端功能合并到 main。

修改前端时，在支持的 Node 环境重新构建，并将源码及产物一起提交：

```sh
(cd web/control-ui && npm ci && npm run build)
touch internal/api/webdist/.gitkeep
git add -A internal/api/webdist
```

Vite 会清理旧产物；提交时要包含旧哈希文件的删除，避免仓库积累过期资源。Docker 构建仍按 Dockerfile 重新构建页面。
