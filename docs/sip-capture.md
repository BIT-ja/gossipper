# SIP 信令采集

创建任务或压测时手动勾选采集；默认关闭。仅支持 UDP。所有本地新建通话的 Call-ID 追加最少四位的任务内通话序号，例如 `gossip-…-0001`、`gossip-…-10001`。外部来话保留对端 Call-ID，内部另行编号。

每任务 `artifacts/jobs/<job>/sip-capture/` 保存 `catalog.sqlite`、状态文件和 `shard-000001.sqlite` 等分片。分片号 `(call_seq-1)/10000+1`，一通电话的所有报文落在同一分片；未关联报文落在分片0。Call-ID 完整匹配catalog后定位分片，不信任外部任意Call-ID后缀。消息索引 `(call_seq,seq)` 支持游标分页，禁止大OFFSET或全文扫描。

UDP 发送在socket写入后捕获（失败标为send_error），接收在分发给场景前捕获；保留重复报文和未消费的响应。发送成功不证明对端收到。仅覆盖本进程的UDP socket，不代表FreeSWITCH/OpenSIPS全链路抓包。

异步队列、单写入线程、100条/200ms批量事务，WAL。无磁盘容量检查、文件大小配额或总量配额。队列满/实际写入失败时累积丢弃并报告不完整，不能把部分采集视为完整。鉴权头及SDP密钥材料脱敏，导出不是逐字节PCAP。

默认任务结束后保留7天；UI主进程每小时清理已过期任务信令。API过期后立即返回明确过期状态。删除已结束任务同步删除信令；运行中任务不能删除。

## 页面

任务详情、报告预览内可查看“已捕获通话”，不必等通话结束；点击Call-ID打开时序图弹窗。支持新标签页、刷新恢复、每2秒增量读取、200条游标分页、查询当前页报文、JSONL导出。协议字段和用户内容不翻译，系统管理界面使用简体中文。

## API

均沿用 `/api/v2` 登录鉴权：

- POST jobs 或 load-test/run：`sip_capture: {enabled:true,retention_days:7}`。
- GET jobs/:id/sip-capture：采集状态、持久化数量、丢弃数、错误和到期时间。
- GET jobs/:id/sip-calls?after=0&limit=200：通话目录游标页。
- GET jobs/:id/sip-messages?call_id=...&after=0&limit=200：消息游标页。空call_id查询未关联消息。
- GET jobs/:id/sip-export?call_id=...：当前通话JSONL；显式空call_id导出未关联消息；省略call_id导出全任务（按通话分组）。

历史未开启采集的任务没有可还原信令，不根据结果补造SIP时序。

当前大通话量内存优化针对UAC：目录提交后淘汰内存Call-ID登记，迟到消息由写入线程按完整Call-ID回查。UAS仍保留任务内映射，长时间大量外部来话需单独做容量验收。
