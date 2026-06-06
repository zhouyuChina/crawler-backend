# CRM 抓取逻辑 — 简明版

## 一句话

插件把浏览器请求转给后端；**普通 URL 每次转发**，**表格 URL 额外触发后端自动翻页抓明细 + 汇总**。

---

## 你的插件配置

| 配置项 | 值 |
|--------|-----|
| 服务器 | `http://202.155.9.144:3000/api/plugin/requests` |
| 普通 URL | `get_curcall_in/out`、`get_peer_status`、`cont_controler` |
| IP | `203.175.165.11*`、`173.234.2.174*` |
| 表格 URL | `cc_voiceivr`、`cc_voiceop` |

**前提**：请求里必须有 Cookie，否则插件不转发。

---

## 两条线

### 线 1：普通抓取（通话等）

```
浏览器请求 → 插件 → POST /api/plugin/requests → 后端代发 → 存 webpages
```

- **每次命中都处理**，没有 5 分钟限制
- 典型：`get_peer_status` 几秒一次，正常
- 内容没变时，可能只跳过 WebSocket 推送，请求仍会处理

---

### 线 2：表格抓取（语音/人工记录）

```
打开 cc_voiceivr 页面 → 插件 → POST /api/plugin/table-crawl → 后端自己翻页
```

同时还会走线 1 转发一次（页面 HTML 进 webpages），但**明细和汇总走 table-crawl**。

| 数据 | 存哪 | 什么时候写 |
|------|------|------------|
| **汇总**（152656 那条统计） | `voice_ivr_summaries` | 第 1 页解析完**马上**写 |
| **明细**（每行通话） | `voice_ivr_records` | 第 1 页 + 后台继续翻页 |

**5 分钟节流**：只限制后台明细翻页是否重新启动；5 分钟内重复请求仍会刷新 summary。  
**busy 锁**：只锁后台明细翻页；上次翻页还在跑时，新的请求仍会刷新 summary，但不会再启动一条明细后台任务。

---

## 表格每次抓多少页？

看站点总页数有没有变：

| 情况 | 抓几页 |
|------|--------|
| 第一次 | 全部页（如 15266 页） |
| 总页数多了 10 页 | 11 页 |
| 总页数没变 | **至少抓前 10 页** |
| 总页数变少了 | 重新全量 |

明细按 `(mid, recordId)` 去重，老 recordId 不会重复插入。

---

## 单页失败怎么办？

翻到第 20 页网络断了：

1. 当前页重试 3 次
2. 仍失败 → 记入队列，**继续抓 21、22…**
3. 全部跑完后，**再补抓一轮**失败页

---

## 怎么判断是否正常？

### 普通请求（get_peer_status）

插件 Console：

```text
[转发成功]: ...get_peer_status.php...
```

不应出现 `[表格抓取]`。

---

### 表格（cc_voiceivr）

插件 Console：

```text
[表格抓取] 触发后端分页: ...cc_voiceivr/?mid=24
[表格抓取] 已启动 voice_ivr mid=24 pages=1/15266
```

后端日志：

```text
首页解析 voice_ivr:24: html=9314b rows=10 totalPages=15266
广播表格汇总: voice_ivr mid=24 pages=...
```

几秒内查汇总应有新行：

```sql
SELECT "totalRecords", "totalPages", "createdAt"
FROM voice_ivr_summaries WHERE mid = 24
ORDER BY "createdAt" DESC LIMIT 1;
```

---

## 常见「没更新」原因

| 现象 | 原因 |
|------|------|
| 表格完全没反应 | 无 Cookie / 表格规则没命中 / 首页抓取失败 |
| 有 summary、明细不涨 | 5 分钟内重复触发只刷新 summary / 上次明细任务还在跑（busy）/ 前 10 页 recordId 都已存在 |
| get_peer_status 正常、表格不行 | 表格走另一条接口 `table-crawl`，和 requests 无关 |
| summary 全是 0 | 后端 HTML 解析失败（已修 gzip）；或页面里没有汇总区 |

---

## 和 5 分钟的关系

| | 普通 requests | 表格 table-crawl |
|--|---------------|------------------|
| 5 分钟限制 | ❌ 没有 | 仅限制后台明细启动，不限制 summary 和第 1 页 |
| 自动定时抓 | ❌ 没有，只有打开页面才触发 | ❌ 同上 |

插件里的 100ms 限流只是控制转发速度，不是 5 分钟。

---

详细版见：[CRAWL_EXPECTED_BEHAVIOR.md](./CRAWL_EXPECTED_BEHAVIOR.md)
