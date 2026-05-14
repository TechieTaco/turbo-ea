# GRC

**GRC** 模块将治理（Governance）、风险（Risk）与合规（Compliance）整合到 `/grc` 下的统一工作区。它把原本散布于 EA 交付与 TurboLens 之间的工作合并起来，让架构师、风险责任人与合规审查者可以在共同的基础上协作。

GRC 共有三个标签页：

- **治理** — EA 原则与 Architecture Decision Records（ADR）。
- **风险** — TOGAF 阶段 G 的[风险登记册](risks.md)。
- **合规** — 之前位于 TurboLens 的按需扫描器（CVE + 法规差距分析）。

任意标签页都可以通过 `/grc?tab=governance`、`/grc?tab=risk` 或 `/grc?tab=compliance` 直接深链。

## 治理

并排两个面板：

- **原则** — 元模型中已发布 EA 原则的只读浏览器（声明、依据、影响）。请在「管理 → 元模型 → 原则」中编辑目录。
- **决策** — Architecture Decision Records。每条 ADR 记录状态、背景、决策、所考虑的备选方案以及后果。由 TurboLens Architect 向导生成的决策以草稿形式落入此处，供审查者签发。

## 风险

嵌入 TOGAF 阶段 G 的**风险登记册**。完整的生命周期、状态工作流、矩阵切换与责任人行为详见[风险登记册指南](risks.md)。要点如下：

- 登记册位于 `/grc?tab=risk`（此前位于 EA 交付下）。
- 风险可以手动创建，也可以从合规标签页的 CVE 或合规发现中**升级**而来。
- 升级是幂等的——发现一旦被升级，按钮即切换为「打开风险 R-000123」。

## 合规

按需的安全扫描器，由两个相互独立的部分组成：

- **CVE 扫描** — 针对当前生效景观中的供应商 / 产品 / 版本查询 NIST NVD，再由 LLM 对发现进行优先级排序。
- **合规扫描** — 针对启用的法规（默认包含 EU AI 法、GDPR、NIS2、DORA、SOC 2、ISO 27001；管理员可在「管理 → 法规」中启用更多）逐项进行 AI 差距分析。

发现在**重新扫描后依然持久** — 用户的判定、审查备注以及到已升级风险的反向链接均会在后续扫描中保留。下一次扫描不再报告的发现会被标记为 `auto_resolved` 并默认隐藏；此前升级的风险保持不变，以免审计踪迹断裂。

合规网格镜像了清单网格：带列可见性切换、可持久化排序的过滤侧栏，以及展示合规生命周期（`new → in_review → mitigated → verified`，并以 `risk_tracked`、`accepted` 与 `not_applicable` 作为侧支）的明细抽屉。

## 权限

| 权限 | 默认角色 |
|------|----------|
| `grc.view` | admin、bpm_admin、member、viewer |
| `grc.manage` | admin、bpm_admin、member |
| `risks.view` / `risks.manage` | 参见[风险登记册 § 权限](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | 参见[TurboLens § Security & Compliance](turbolens.md) |

`grc.view` 控制 GRC 路由本身的可见性——若缺少该权限，顶部导航中的入口会被隐藏。每个标签页另外强制其领域专有权限，因而一名查看者可以阅读登记册而无法触发 LLM 扫描，举例而言。
