# 并发状态 — 请求规律

> 实测环境：`http://173.234.2.174:55668/`，账号 732100，菜单：**系统监控 → 并发状态**  
> 观察窗口：约 2 分钟（进入页面后 reqid > 2062）

## 页面结构

进入后 iframe 加载：

```text
/modules/cc_mrcall/?mid=5&muser=732100&st_key=enable&st_type=desc
```

页面内 JS 含：

```javascript
window.setTimeout('this.location.reload();', 30000);
```

即 **每 30 秒整页 reload**，不是 AJAX 轮询子接口。

## 插件 4 规则命中情况（持续轮询）

| 规则 | 是否持续命中 | 说明 |
|------|-------------|------|
| `*get_peer_status.php?` | **是** | 全局每 5 秒，来自 index 顶栏 |
| `*get_curcall_in.php?` | **否** | 仅切页瞬间残留几条，进入 mrcall 后停止 |
| `*get_curcall_out.php?` | **否** | 同上 |
| `*cont_controler.php?` | **否** | 0 次 |

## 并发状态页专属请求

### 1. cc_mrcall 整页刷新（核心）

```http
GET /modules/cc_mrcall/?mid=5&muser=732100&st_key=enable&st_type=desc
```

- 间隔：**30 秒**（实测 avg 29999.5ms，页面 `setTimeout(..., 30000)`）
- 2 分钟约 **5 次**（含首次加载）
- 返回：完整 HTML（账号并发数、群呼任务列表等）
- **不在**插件现有 4 条 URL 过滤规则内

参数说明：

| 参数 | 值 | 说明 |
|------|-----|------|
| `mid` | 5 | 菜单 ID（本账号固定） |
| `muser` | 732100 | 登录账号 |
| `st_key` | enable | 排序字段 |
| `st_type` | desc | 排序方向 |

### 2. get_peer_status.php（全局附带）

```http
GET /modules/get_peer_status.php?date={毫秒时间戳}
```

- 间隔：**5 秒**（与是否在本页无关，index 顶栏一直跑）
- 2 分钟约 **29 次**
- 返回：座席状态色块 + 在线分机号 HTML

## 用户操作时才触发的 AJAX（非定时轮询）

页面内点击按钮时会请求（**后端定时抓取不需要**）：

- `../cc_monitor/enable.php` — 启用/禁用群呼
- `../cc_monitor/delete-i.php` — 删除号段
- `../cc_monitor/cseq_mode.php` — 顺序/乱数自动
- `../cc_monitor/sel_process.php` — 勾选删除/发送
- `maxchannel_update.php` — 修改呼叫线路数
- `outcall_pause.php` — 暂停/恢复外呼
- `del_all.php` — 全部删除

## 后端勾选「并发状态」时的调度建议

```text
Timer A: 每 5000ms  → GET /modules/get_peer_status.php?date={ts}
Timer B: 每 30000ms → GET /modules/cc_mrcall/?mid=5&muser={账号}&st_key=enable&st_type=desc
```

`mid` 可能因账号/菜单不同而变化，需从登录后菜单或首次进入 URL 解析。

## 与「语音呼叫状态」的区别

| | 语音呼叫状态 | 并发状态 |
|--|-------------|---------|
| 主数据刷新 | 4 路 AJAX（0.6s / 1.2s / 5s / 20s） | **整页 reload 30s** |
| cc_monitor 子 API | 持续轮询 | **不轮询** |
| 插件 4 规则 | 4 条全中 | **仅 get_peer_status** |
