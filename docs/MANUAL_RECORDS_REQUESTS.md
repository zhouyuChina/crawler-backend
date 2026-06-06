# 人工记录 — 请求规律

> 实测环境：`http://173.234.2.174:55668/`，账号 732100，菜单：**系统监控 → 人工纪录**  
> 观察窗口：约 2 分钟（进入页面后 reqid > 2300）

## 页面结构

进入后 iframe 加载：

```text
GET /modules/cc_voiceop/?mid=25
```

- 无 `setTimeout` / `setInterval` 自动刷新
- 无 AJAX 轮询子接口
- **静态表格页**：打开时请求一次，之后不再自动拉数据（除非用户翻页/搜索）

分页 URL 规律：

```text
/modules/cc_voiceop/index.php?mid=25&pageID={页码}
```

首页 HTML 含汇总 + 明细 + 分页信息，例如：

- 汇总：`通話紀錄：133055 | 初始：127 振鈴：88560 通話：43765 座席：603`，以及接通率/回拨率
- 分页：`共有 61 頁`（实测当时数据量）
- 默认筛选：起始/终止日期（如 2026-06-01 ~ 2026-06-04）

## 插件 4 规则命中情况（2 分钟内）

| 规则 | 持续命中？ | 次数 |
|------|-----------|------|
| `*get_peer_status.php?` | **是** | 26（每 5 秒） |
| `*get_curcall_in.php?` | 否 | 0 |
| `*get_curcall_out.php?` | 否 | 0 |
| `*cont_controler.php?` | 否 | 0 |

`get_peer_status` 来自 index 顶栏全局轮询，与人工记录页本身无关。

## 本页专属请求

### 首次加载（仅 1 次）

```http
GET /modules/cc_voiceop/?mid=25
Referer: /modules/index.php
Cookie: x-token; reqId; PHPSESSID; COOKIE_USER_ID; ...
```

返回：完整 HTML（汇总区 + 明细表格 + 分页链接）。

明细字段：任务、主叫、被叫、座席、终止原因、转呼时长、呼叫时间、终止时间等。

### 翻页（用户操作时）

```http
GET /modules/cc_voiceop/index.php?mid=25&pageID=2
```

后端表格抓取应对齐此 URL 模式（与插件 `*/modules/cc_voiceop*` 一致）。

### 用户搜索（非定时）

点击 Search 会带查询参数 GET 本页，例如 `ft_task`、`ft[src]`、`startdate`、`enddate`、`op_mod` 等。定时抓取通常用默认无筛选首页即可。

## 后端勾选「人工记录」时的建议

本页**没有**浏览器式的定时 AJAX。后端应：

```text
1. 登录拿 Cookie
2. 定时（如每 5 分钟，或按现有 table-crawl 节流）请求：
   GET /modules/cc_voiceop/?mid={mid}
3. 解析首页汇总并触发分页抓取：
   GET /modules/cc_voiceop/index.php?mid={mid}&pageID={n}
4. 复用现有 voice-table 入库逻辑（voice_op 相关表，若已实现）
```

可选附带（若也需要顶栏座席状态）：

```text
每 5000ms → GET /modules/get_peer_status.php?date={ts}
```

`mid=25` 为本账号实测值，不同账号/菜单可能不同，需从首次进入 URL 解析。

## 与插件的关系

插件「表格分页 URL 规则」`*modules/cc_voiceop*` 会在用户打开本页时命中一次入口 URL，后端 `table-crawl` 接管后续翻页。后端账号密码模式应模拟同一触发方式。

## 与「语音记录」的对比

| | 语音记录 | 人工记录 |
|--|---------|---------|
| 模块路径 | `cc_voiceivr` | `cc_voiceop` |
| 入口 URL | `/?mid=24` | `/?mid=25` |
| 分页 | `index.php?mid=24&pageID=n` | `index.php?mid=25&pageID=n` |
| 页面自动轮询 | **无** | **无** |
| 插件 4 规则 | 仅 get_peer_status | 仅 get_peer_status |
| 抓取方式 | 表格分页 crawl | 表格分页 crawl |
