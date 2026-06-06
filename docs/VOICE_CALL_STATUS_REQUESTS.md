# 语音呼叫状态 — 轮询请求规律

> 实测环境：`http://173.234.2.174:55668/`，账号 732100，菜单：**系统监控 → 语音呼叫状态**  
> 观察窗口：约 3 分钟（reqid 基准线之后 200+ 秒）

## 页面结构

进入后加载 `/modules/cc_monitor/?mid=9`，内含 3 个子 iframe：

| 区域 | 静态页 | 轮询 API |
|------|--------|----------|
| 外呼列表（上） | `curcall_out.php` | `get_curcall_out.php` |
| 人工/回拨（下） | `curcall_in.php` | `get_curcall_in.php` |
| 群呼控制表（中） | `controler.php` | `cont_controler.php` |

顶部状态栏（任意 index 子页）额外轮询 `get_peer_status.php`。

## 4 类命中请求

### 1. get_peer_status.php

```http
GET /modules/get_peer_status.php?date={毫秒时间戳}
Referer: /modules/index.php
```

- 间隔：**5 秒**（实测 avg 5000ms，100% ±50ms）
- 3 分钟约 **41 次**
- 返回：座席状态色块 HTML（綠色-待機、紅色-離線…）
- **全局轮询**，不只在 cc_monitor 内

### 2. get_curcall_in.php

```http
GET /modules/cc_monitor/get_curcall_in.php?date={毫秒时间戳}
Referer: /modules/cc_monitor/curcall_in.php
```

- 间隔：**0.6 秒**（实测 avg 600ms）
- 3 分钟约 **346 次**
- 返回：被叫、回拨号码、呼叫状态等 HTML 表格

### 3. get_curcall_out.php

```http
GET /modules/cc_monitor/get_curcall_out.php?date={毫秒时间戳}
Referer: /modules/cc_monitor/curcall_out.php
```

- 间隔：**1.2 秒**（实测 avg 1200ms，98.8% ±50ms）
- 3 分钟约 **173 次**
- 返回：主叫、被叫、语音振铃/通话状态等 HTML 表格
- 与 `get_curcall_in` 比例 **2:1**

### 4. cont_controler.php

```http
GET /modules/cc_monitor/cont_controler.php?muser={账号}&max=200&st_key=enable&st_type=desc&date={毫秒时间戳}&campnum=0
Referer: /modules/cc_monitor/controler.php
```

- 间隔：**20 秒**（实测 avg 20000ms，100% ±50ms）
- 3 分钟约 **10 次**
- `muser` = 登录账号；`max` = 呼叫线路数（页面选 200）；`campnum=0` 固定
- 返回：群呼任务列表 HTML

## 后端勾选「语音呼叫状态」时的调度建议

登录后带 Cookie，同时跑 4 个定时器：

| 定时器 | 间隔 | URL |
|--------|------|-----|
| A | 5000ms | `/modules/get_peer_status.php?date={ts}` |
| B | 600ms | `/modules/cc_monitor/get_curcall_in.php?date={ts}` |
| C | 1200ms | `/modules/cc_monitor/get_curcall_out.php?date={ts}` |
| D | 20000ms | `/modules/cc_monitor/cont_controler.php?muser={账号}&max=200&st_key=enable&st_type=desc&date={ts}&campnum=0` |

`{ts}` = `Date.now()` 毫秒时间戳，仅防缓存。

## 插件 URL 过滤规则对应

插件规则（通配）均可命中，但实际路径分两类：

- `/modules/get_peer_status.php`
- `/modules/cc_monitor/get_curcall_in.php`
- `/modules/cc_monitor/get_curcall_out.php`
- `/modules/cc_monitor/cont_controler.php`
