# 抓取账号配置使用说明

## 功能概述

后端现在支持多组 CRM 账号自动抓取，无需依赖浏览器插件（插件保留作为 Cookie 回退）。

每组配置包含：
- CRM 地址、账号、密码
- 勾选抓取内容（语音呼叫状态 / 并发状态 / 语音记录 / 人工记录）
- 是否启用

---

## 部署前配置

在 `.env` 文件中添加管理账密：

```env
CRAWL_ADMIN_USERNAME=admin
CRAWL_ADMIN_PASSWORD=your_secure_password
```

未配置时，配置管理页面和所有配置 API 均返回 400 错误。

---

## 访问管理页面

```
http://your-server:3000/api/crawl-profiles/page
```

首次访问需输入上面 env 中配置的管理账密登录。登录态通过 HttpOnly Cookie 保持 8 小时。

---

## 抓取内容与调度规则

| 勾选内容 | 触发的请求 | 频率 |
|---|---|---|
| 任意一项 | `get_peer_status.php` | 每 5 秒（全局去重，只发 1 路）|
| 语音呼叫状态 | `get_curcall_in.php` | 每 600ms |
| 语音呼叫状态 | `get_curcall_out.php` | 每 1200ms |
| 语音呼叫状态 | `cont_controler.php` | 每 20s |
| 并发状态 | `cc_mrcall/` | 每 30s |
| 语音记录 | `cc_voiceivr/` | 每 5 分钟（触发表格分页抓取）|
| 人工记录 | `cc_voiceop/` | 每 5 分钟（触发表格分页抓取）|

**去重说明**：同一配置同时勾选多个内容时，`get_peer_status` 只会调度一路，不会重复发送。

---

## API 端点

所有配置 API 需要管理员登录（HttpOnly Cookie）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/crawl-profiles/page` | 管理页面 |
| POST | `/api/crawl-profiles/login` | 管理员登录 |
| POST | `/api/crawl-profiles/logout` | 退出 |
| GET | `/api/crawl-profiles/session` | 检查登录状态 |
| GET | `/api/crawl-profiles` | 获取所有配置（密码脱敏）|
| POST | `/api/crawl-profiles` | 新增配置 |
| PUT | `/api/crawl-profiles/:id` | 修改配置 |
| PATCH | `/api/crawl-profiles/:id/enabled` | 启停 |
| DELETE | `/api/crawl-profiles/:id` | 删除 |
| POST | `/api/crawl-profiles/:id/test-login` | 测试 CRM 登录 |
| POST | `/api/crawl-profiles/:id/run-once` | 立即触发一次全部任务 |

---

## CRM 登录状态说明

| 状态 | 含义 | 处理方式 |
|---|---|---|
| `ok` | 已成功登录，Cookie 有效 | 正常调度 |
| `login_failed` | 账号或密码错误 | 暂停该配置的调度，点「测试登录」修复后自动恢复 |
| `human_check_required` | CRM 返回了真人校验页 | 暂停该配置，可通过插件手动操作，或稍后重试 |
| `unknown` | 未登录（新建或密码修改后重置）| 下次调度时自动尝试登录 |

Cookie 缓存有效期 30 分钟，过期后自动重新登录。

---

## 默认 mid 值

| 模块 | 默认 mid |
|---|---|
| 语音呼叫状态 | 9 |
| 并发状态 | 5 |
| 语音记录 | 24 |
| 人工记录 | 25 |

如果你的 CRM 中 mid 不同，可在管理页面「高级」中修改。

---

## 插件回退说明

浏览器插件（`crm-chrome-crawler`）继续保留。当某个配置遇到真人校验（`human_check_required`）时：

1. **在配置页里填的 CRM 地址**（如 `http://173.234.2.174:55668`）必须与浏览器里打开的 CRM **主机名和端口一致**，否则插件 Cookie 无法匹配到该配置。
2. 插件服务器地址填：`http://localhost:3000/api/plugin/requests`（或你的后端地址）。
3. 插件 **IP 白名单** 要包含 CRM 的 IP（默认只有 `203.175.165.*`、`127.0.0.1`，需加上如 `173.234.2.174` 或 `173.234.*`）。
4. 在浏览器里**手动登录并完成验证码**后，随便打开会发请求的 CRM 页面（如语音呼叫状态），插件会把带 Cookie 的请求转发到后端。
5. 后端会把 Cookie 写入匹配的抓取配置，状态变为 **已登录**；自动调度恢复。
6. **「测试登录」**走的是服务端程序登录，遇验证码仍会失败；插件同步 Cookie 后再点测试登录，或刷新配置页看状态即可。

> 注意：仅配置插件地址不够，必须同时有「抓取配置」且 `baseUrl` 与 CRM 一致。
