# 语音记录 — 请求规律

> 实测环境：`http://173.234.2.174:55668/`，账号 732100，菜单：**系统监控 → 语音纪录**  
> 观察窗口：约 2 分钟（进入页面后 reqid > 2256）

## 页面结构

进入后 iframe 加载：

```text
GET /modules/cc_voiceivr/?mid=24
```

- 无 `setTimeout` / `setInterval` 自动刷新
- 无 AJAX 轮询子接口
- **静态表格页**：打开时请求一次，之后不再自动拉数据（除非用户翻页/搜索）

分页 URL 规律：

```text
/modules/cc_voiceivr/index.php?mid=24&pageID={页码}
```

首页 HTML 含汇总 + 明细 + 分页信息，例如：

- 汇总：`語音紀錄分析：130482`，以及接通失败/忙线/无人接听/语音通话计数
- 分页：`共有 13065 頁 130643 筆`

## 插件 4 规则命中情况（2 分钟内）

| 规则 | 持续命中？ | 次数 |
|------|-----------|------|
| `*get_peer_status.php?` | **是** | 29（每 5 秒） |
| `*get_curcall_in.php?` | 否 | 0 |
| `*get_curcall_out.php?` | 否 | 0 |
| `*cont_controler.php?` | 否 | 0 |

`get_peer_status` 来自 index 顶栏全局轮询，与语音记录页本身无关。

## 本页专属请求

### 首次加载（仅 1 次）

```http
GET /modules/cc_voiceivr/?mid=24
Referer: /modules/index.php
Cookie: x-token; reqId; PHPSESSID; COOKIE_USER_ID; ...
```

返回：完整 HTML（汇总区 + 明细表格 + 分页链接）。

### 翻页（用户操作时）

```http
GET /modules/cc_voiceivr/index.php?mid=24&pageID=2
```

后端表格抓取应对齐此 URL 模式（与现有 `VoiceTableService` / 插件 `*/modules/cc_voiceivr*` 一致）。

## 后端勾选「语音记录」时的建议

本页**没有**浏览器式的定时 AJAX。后端应：

```text
1. 登录拿 Cookie
2. 定时（如每 5 分钟，或按现有 table-crawl 节流）请求：
   GET /modules/cc_voiceivr/?mid={mid}
3. 解析首页汇总并触发分页抓取：
   GET /modules/cc_voiceivr/index.php?mid={mid}&pageID={n}
4. 复用现有 voice-table 入库逻辑（voice_ivr_summaries / voice_ivr_records）
```

可选附带（若也需要顶栏座席状态）：

```text
每 5000ms → GET /modules/get_peer_status.php?date={ts}
```

`mid=24` 为本账号实测值，不同账号/菜单可能不同，需从首次进入 URL 解析。

## 与插件的关系

插件「表格分页 URL 规则」`*modules/cc_voiceivr*` 会在用户打开本页时命中一次入口 URL，后端 `table-crawl` 接管后续翻页。后端账号密码模式应模拟同一触发方式。
