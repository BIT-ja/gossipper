# 本地容器部署

前提：Docker Engine / Docker Desktop 和 Docker Compose 可用。

```sh
export GOSSIPPER_BOOTSTRAP_PASSWORD='请替换为至少8位密码'
docker compose -f compose.local.yaml up -d --build
docker compose -f compose.local.yaml ps
```

浏览器访问 http://127.0.0.1:18080，用户名 `admin`，密码为首次启动时指定的值。
密码通过环境变量注入，不写入镜像。已有数据卷上的账号不会因更改 bootstrap 密码而重置。

```sh
# 查看日志
docker compose -f compose.local.yaml logs --tail=100
# 停止，保留账号、配置、任务和音频
docker compose -f compose.local.yaml down
```

数据位于命名卷 `gossipper-local-data`（实际名称包含 Compose 项目前缀），挂载到 `/var/lib/gossipper`。
不要使用 `down -v`，除非明确要删除本地测试数据。

镜像通过 Node 22 构建页面，再由 Go 1.26.1 编译并嵌入页面。运行用户为 UID/GID 10001，时区 Asia/Shanghai。

## SIP 测试与服务器部署差异

此 Compose 仅将 Web 端口映射到本机回环地址；本机 SIP 测试应让服务端、客户端任务都在同一容器内，以 `127.0.0.1` 互通。
Docker Desktop 的网络不能等同于 Linux 服务器宿主机网络。外部 SIP/RTP 压测需要单独配置双向可达的 SIP/RTP 地址及端口。
Linux 服务器建议使用宿主机网络、单副本、持久化数据目录，并在发布前结束运行中的压测任务。

本地默认构建当前 CPU 架构；amd64 服务器应在对应构建机上构建，或执行：

```sh
docker buildx build --platform linux/amd64 -t gossipper:amd64 --load .
```

镜像包含中文界面、信令采集、实时进度及东八区时间等定制功能；发布时以构建提交为准。
