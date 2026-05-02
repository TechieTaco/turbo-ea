# API 参考

Turbo EA 提供了一套完整的 **REST API**，为 Web 界面中的所有操作提供支持。你可以使用它来自动化清单更新、与 CI/CD 流水线集成、构建自定义仪表板，或将 EA 数据接入其他工具（BI、GRC、ITSM、电子表格）。

同一套 API 通过 **FastAPI 内置的 Swagger UI** 提供交互式文档，管理员和开发者可以浏览每个端点、查看请求/响应模式，并直接在浏览器中尝试调用。

---

## 基础 URL

所有 API 端点都位于 `/api/v1` 前缀之下：

```
https://your-domain.example.com/api/v1
```

本地（默认 Docker 配置）：

```
http://localhost:8920/api/v1
```

唯一的例外是健康检查端点，它挂载在 `/api/health`（无版本前缀）。

---

## 交互式 API 参考（Swagger UI）

FastAPI 会从后端代码自动生成 OpenAPI 3 规范，并在旁边提供交互式 Swagger UI。这是每个端点、参数和响应结构的**唯一权威来源**。

| URL | 描述 |
|-----|------|
| `/api/docs` | Swagger UI — 在浏览器中浏览、搜索并尝试端点 |
| `/api/redoc` | ReDoc — 另一种只读文档视图 |
| `/api/openapi.json` | 原始的 OpenAPI 3 模式（适用于 `openapi-generator-cli` 等代码生成器） |

!!! warning "仅在开发模式下可用"
    出于安全考虑，API 文档端点在**生产环境中被禁用**。它们只有在你的 `.env` 文件中设置了 `ENVIRONMENT=development` 时才会被提供。在生产部署中，OpenAPI 模式不会公开暴露 — 但 API 本身的工作方式完全相同。

    要浏览生产实例的 API 参考，请在开发模式下运行一个本地 Turbo EA 实例（同一版本的部署之间模式是一致的），或临时切换到 `ENVIRONMENT=development`，重启后端，完成后再撤回更改。

### 在 Swagger UI 中尝试端点

1. 在浏览器中打开 `/api/docs`。
2. 点击右上角的 **Authorize**。
3. 将一个有效的 JWT（不带 `Bearer ` 前缀）粘贴到 `bearerAuth` 字段中并确认。
4. 展开任意端点，点击 **Try it out**，填写参数并点击 **Execute**。

Swagger 会使用你的令牌从浏览器发送请求，因此通过 API 能做的任何事情都可以在此页面完成 — 这对临时管理任务和验证权限行为非常有用。

---

## 身份验证

除 `/auth/*`、健康检查和公共 Web 门户之外，所有端点都要求在 `Authorization` 头中发送 JSON Web Token：

```
Authorization: Bearer <access_token>
```

### 获取令牌

使用电子邮件和密码调用 `POST /api/v1/auth/login`：

```bash
curl -X POST https://your-domain.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "your-password"}'
```

响应中包含一个 `access_token`：

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

令牌默认有效期为 24 小时（`ACCESS_TOKEN_EXPIRE_MINUTES`）。使用 `POST /api/v1/auth/refresh` 可以延长会话而无需重新输入凭据。

!!! tip "SSO 用户"
    如果你的组织使用单点登录，则无法用电子邮件/密码登录。可以请管理员为自动化创建一个具有本地密码的服务账户，或在通过常规 SSO 登录后从浏览器的 session storage 中读取 JWT（仅供开发使用）。

### 使用令牌

```bash
curl https://your-domain.example.com/api/v1/cards \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## 权限

API 强制执行**与 Web 界面相同的 RBAC 规则**。每个修改数据的端点都会检查调用者的应用级角色以及他在受影响 card 上持有的所有 stakeholder 角色。不存在单独的「API 权限」或服务账户旁路 — 自动化脚本以其使用的令牌所对应用户的权限运行。

如果请求返回 `403 Forbidden`，说明令牌有效但用户缺少所需权限。请查阅 [用户与角色](users.md) 页面中的权限注册表。

---

## 常用端点分组

完整参考请见 Swagger；下表是最常用分组的快速地图：

| 前缀 | 用途 |
|------|------|
| `/auth` | 登录、注册、SSO 回调、令牌刷新、当前用户信息 |
| `/cards` | card（核心实体）的 CRUD、层级、历史、审批、CSV 导出 |
| `/relations` | card 之间关系的 CRUD |
| `/metamodel` | card 类型、字段、章节、子类型、关系类型 |
| `/reports` | 仪表板 KPI、组合、矩阵、生命周期、依赖、成本、数据质量 |
| `/bpm` | 业务流程管理 — 图、元素、流程版本、评估 |
| `/ppm` | 项目组合管理 — 计划、状态报告、WBS、任务、成本、风险 |
| `/turbolens` | AI 驱动的分析（厂商、重复项、安全、架构 AI） |
| `/risks` | EA 风险登记册（TOGAF 阶段 G） |
| `/diagrams` | DrawIO 图 |
| `/soaw` | Statement of Architecture Work 文档 |
| `/adr` | Architecture Decision Records |
| `/users`、`/roles` | 用户和角色管理（仅管理员） |
| `/settings` | 应用设置（徽标、货币、SMTP、AI、模块开关） |
| `/servicenow` | 与 ServiceNow CMDB 的双向同步 |
| `/events`、`/notifications` | 审计跟踪和用户通知（包括 SSE 流） |

---

## 分页、过滤和排序

列表端点接受一组一致的查询参数：

| 参数 | 描述 |
|------|------|
| `page` | 页码（从 1 开始） |
| `page_size` | 每页条目数（默认 50，最多 200） |
| `sort_by` | 排序字段（例如 `name`、`updated_at`） |
| `sort_dir` | `asc` 或 `desc` |
| `search` | 全文过滤（若支持） |

每个端点的资源专属过滤器都在 Swagger 中文档化（例如 `/cards` 接受 `type`、`status`、`parent_id`、`approval_status`）。

---

## 实时事件（Server-Sent Events）

`GET /api/v1/events/stream` 是一个长连接 SSE，会在事件发生时实时推送（card 创建、更新、批准等）。Web 界面利用它在不轮询的情况下刷新徽章和列表。任何支持 SSE 的 HTTP 客户端都可以订阅 — 适合构建实时仪表板或外部通知桥。

---

## 代码生成

由于 API 完全由 OpenAPI 3 描述，你可以为各主流语言生成强类型客户端：

```bash
# 从开发实例下载模式
curl http://localhost:8920/api/openapi.json -o turbo-ea-openapi.json

# 生成 Python 客户端
openapi-generator-cli generate \
  -i turbo-ea-openapi.json \
  -g python \
  -o ./turbo-ea-client-py

# …或 TypeScript、Go、Java、C# 等
```

对于 Python 自动化，最简单的做法通常是使用 `httpx` 或 `requests` 手写调用 — API 足够小，生成器很少值得引入这一额外依赖。

---

## 速率限制

身份验证敏感端点（登录、注册、重置密码）通过 `slowapi` 限速以防御暴力破解。其他端点默认不限速；如果需要为重型自动化脚本节流，请在客户端或反向代理层面进行控制。

---

## 版本控制与稳定性

- API 通过 `/api/v1` 前缀进行版本控制。破坏性变更将以并行的 `/api/v2` 形式引入。
- 在 `v1` 内，添加性变更（新端点、新可选字段）可能在次要版本和补丁版本中发布。删除或合同变更则保留给主版本号变更。
- 当前版本通过 `GET /api/health` 报告，便于自动化系统检测升级。

---

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| `/api/docs` 返回 404 | 生产环境禁用了 Swagger UI。设置 `ENVIRONMENT=development` 并重启后端，或使用开发实例来浏览模式。 |
| `401 Unauthorized` | 令牌缺失、格式不正确或已过期。通过 `/auth/login` 或 `/auth/refresh` 重新认证。 |
| `403 Forbidden` | 令牌有效但用户缺少所需权限。请在 [用户与角色](users.md) 中检查角色配置。 |
| `422 Unprocessable Entity` | Pydantic 验证失败。响应体会列出无效字段及原因。 |
| 浏览器应用出现 CORS 错误 | 将前端来源加入 `.env` 中的 `ALLOWED_ORIGINS` 并重启后端。 |
