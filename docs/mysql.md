# MySQL 存储与 SQLite 迁移

支持 MySQL 5.7+。通过 `GOSSIPPER_MYSQL_DSN` 启用，格式为 Go MySQL DSN（不是 JDBC URL）：

```text
用户名:密码@tcp(主机:3306)/数据库
```

数据库凭据通过 ops Secret 或本地权限为 0600 的环境文件注入。不要提交真实凭据。
设置后账号、任务、产物索引、审计和系统设置使用 `gossipper_` 前缀的 MySQL 表；所有 SIP 信令使用 `gossipper_sip_calls` 和 `gossipper_sip_messages` 两张表，按 job_id 隔离，不分片。

- 通话目录：主键 `(job_id, call_hash)`，唯一索引 `(job_id, call_seq)`。
- 信令：主键 `(job_id, seq)`，分页索引 `(job_id, call_seq, seq)`。
- Call-ID 仍保留任务内序号。完整 Call-ID 保存为 TEXT，使用 SHA-256 做定长查询索引。
- 每 100 条或 200ms 批量写入，同一事务更新信令和通话计数；队列保留有界容量及丢弃统计。
- 删除任务、信令保留期到期时，同时删除该 job_id 的 MySQL 信令。
- 未配置 DSN 时，保留原 SQLite 行为。

场景、客户端/服务端配置、音频、报告、日志和采集状态文件仍在数据卷中，因此仍需要 `/var/lib/gossipper` 持久化。只运行一个管理实例；本次不是多实例调度改造。

## 迁移顺序

1. 结束所有运行/等待任务，停止管理容器。保留原镜像及整个数据卷的离线备份。
2. 确认目标数据库没有其他实例使用 `gossipper_*` 表，授予应用建表及读写权限。
3. 用新镜像挂载同一个离线数据卷、注入 DSN，执行：

```sh
gossipper migrate-mysql --data-dir /var/lib/gossipper
```

迁移会创建表；任何目标表非空时拒绝覆盖。账号哈希、JWT、任务 ID 和纳秒时间原样迁移；SIP 分片合并到统一表，通话计数从信令重建。数据导入使用单个事务，按表核对行数后提交；失败时回滚所有导入行，已创建空表可能保留。源 SQLite 文件不会删除或修改。

大量历史信令会产生较大事务，请预留维护窗口和数据库事务日志空间。命令超时 30 分钟；超时不应直接启动目标实例，应先核验导入结果。

4. 给管理容器持续注入同一 DSN，启动，核验原账号登录、历史任务/信令、以及新任务的采集/查询/导出。
5. 重启并验证持久化。原 SQLite 保留作回退快照，切换后不会继续同步。

本地 Compose 示例（env 文件不入库）：

```sh
docker compose -f compose.local.yaml --env-file /安全路径/bootstrap.env --env-file /安全路径/mysql.env up -d --build
```

## 回退

停止新实例，移除 DSN 后以原镜像和备份数据卷启动即可恢复迁移前状态。切换后写入 MySQL 的新增任务不会自动回写 SQLite；回退前需另行保留这些数据。不要删除 MySQL 表作为回退步骤。
