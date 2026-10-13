# CentOS 7 从源码构建和文件配置

仓库包含预构建 Control UI，拉取 centos7 分支即可使用，无需单独下载页面资源包。CentOS 7 上仅需安装 Go 1.26.1 或兼容的新版本，不需要 Node、npm 或 Docker。程序仍为静态 Linux x86_64 二进制。

```sh
go version
bash scripts/build-server.sh --skip-frontend
./dist/gossipper ui --help
```

`--skip-frontend` 使用包内已构建页面；修改前端后，应在兼容的构建环境执行不带该参数的构建脚本，再同步源码及页面。修改前端源码后必须重新构建并一起提交 internal/api/webdist；缺少 index.html 时脚本会拒绝构建。

## 接替已有安装

先结束运行任务，停止其他连接同一 MySQL 的管理实例。在服务器源码目录执行：

```sh
systemctl stop gossipper
cp -p /opt/gossipper/bin/gossipper /opt/gossipper/bin/gossipper.before-file-config
install -m 0755 dist/gossipper /opt/gossipper/bin/gossipper
install -d -m 0750 -o root -g gossipper /etc/gossipper
# 仅首次创建，保留已有 JSON 配置。
if [ ! -e /etc/gossipper/gossipper.json ]; then
  install -m 0640 -o root -g gossipper deploy/gossipper.example.json /etc/gossipper/gossipper.json
fi
vi /etc/gossipper/gossipper.json
```

填写真实数据库 host、port、database、username、password。`http.listen` 为 Web 监听地址，`data_dir` 保持现有 /var/lib/gossipper，不会重新导入数据库或删除数据。示例密码只是占位值。JSON 中双引号和反斜杠须正确转义。

```sh
runuser -u gossipper -- /opt/gossipper/bin/gossipper ui \
  --config /etc/gossipper/gossipper.json --check-config
install -m 0644 deploy/gossipper.service /etc/systemd/system/gossipper.service
systemctl daemon-reload
systemctl enable --now gossipper
journalctl -u gossipper -n 50 --no-pager
curl -fsS http://127.0.0.1:8080/healthz
```

若改了 Web 端口，相应修改 curl 地址及防火墙规则。`--check-config` 仅检查文件可读、格式及字段，不连接数据库；成功不表示数据库网络或认证已通过。

新 systemd 单元不再加载旧 gossipper.env。旧文件可保留供回退。配置必须允许 gossipper 用户读取，不能设为 root 独占的 0600；推荐目录 root:gossipper 0750，文件 root:gossipper 0640。

## 配置规则

- 启动方式：`gossipper ui --config /etc/gossipper/gossipper.json`。
- 显式 `--listen` / `--data-dir` 参数优先于配置文件；配置未给出时沿用命令行默认值。
- 提供配置文件时 storage.driver 必须明确写 mysql 或 sqlite；mysql 的 host/port/database/username 必填，错误配置直接报错，不回退 SQLite。
- 配置文件中的存储设置覆盖旧 GOSSIPPER_MYSQL_DSN 环境变量；管理服务将实际 DSN 传递给派生任务进程，任务信令仍写到同一后端。
- 不带 --config 时兼容旧参数和环境变量部署。
- 可选 `bootstrap` 对象支持 username/password，只用于空数据库首次创建账号；已有账号不被重置。沿用现有 MySQL 时无需提供。
- 修改文件后需要重启，不支持热加载。
- SIP 本地端口、目标端口、场景和音频仍由页面中的客户端/场景配置管理，不属于 http.listen。

## 当前网络问题

服务器 10.80.16.64 之前到 10.90.0.110:3306 TCP 超时。配置文件应填写该服务器实际可达的数据库地址和端口；更换配置读取方式不会自动打通路由或安全组。不要靠移除 MySQL 配置绕过此问题，否则会切到另一套本地数据。

启用 MySQL 后，页面内客户端/服务端配置及场景/历史也保存在数据库；旧目录首次启动自动迁入，详细规则见 [MySQL 存储](mysql.md#场景和配置入库升级)。运行配置 gossipper.json 仍为启动所需的本地文件。
