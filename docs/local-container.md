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

此 Compose 将 Web 端口映射到本机回环地址，并发布 UDP `15060`（SIP）和 `15062–15261`（RTP/RTCP）。同容器回环测试仍可使用 `127.0.0.1`。

访问外部 SIP 服务时，客户端选择 `u1`、启用传输，绑定 `0.0.0.0:15060`；场景 Contact 使用对端能访问的宿主机 IP 和端口 `15060`，SDP 的 `o=`、`c=` 使用同一可达 IP，`m=audio` 保留 `[media_port]`。不要在容器内绑定宿主机 IP，也不要把抓包中的临时 NAT 源端口写入场景。`rport` 只解决 SIP 响应回程，Contact/BYE 和 SDP/RTP 仍需要上述入站映射。

当前媒体端口按任务内累计通话序号递增：`15060 + 2 × call_number`，并为 RTCP 保留相邻端口。因此默认范围只覆盖每个任务最多 100 通电话，**不是 100 路并发**；超过该总通话量前需扩大映射并检查端口上限。使用该固定 SIP 端口的任务应串行运行。此配置没有引入 RTP 端口池。

服务器触发挂断的场景，应在 ACK 后执行 `<recv request="BYE" timeout="120000"/>`，复制收到的 Via/From/To/Call-ID/CSeq 返回 `200 OK` 后停止 RTP。不要用固定 `pause` 代替等待 BYE，否则暂停期间可能延后响应。

已启用 MySQL 的环境重建容器时，须继续加载原有 `GOSSIPPER_MYSQL_DSN`，避免回退到 SQLite，详见 [MySQL 存储](mysql.md)。
Docker Desktop 的网络不能等同于 Linux 服务器宿主机网络。外部 SIP/RTP 压测需要单独配置双向可达的 SIP/RTP 地址及端口。
Linux 服务器建议使用宿主机网络、单副本、持久化数据目录，并在发布前结束运行中的压测任务。

本地默认构建当前 CPU 架构；amd64 服务器应在对应构建机上构建，或执行：

```sh
docker buildx build --platform linux/amd64 -t gossipper:amd64 --load .
```

镜像包含中文界面、信令采集、实时进度及东八区时间等定制功能；发布时以构建提交为准。
