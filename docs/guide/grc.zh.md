# GRC

**GRC** 模块将治理（Governance）、风险（Risk）与合规（Compliance）整合到 `/grc` 下的统一工作区。它把原本散布于 EA 交付与 TurboLens 之间的工作合并起来，让架构师、风险责任人与合规审查者可以在共同的基础上协作。

GRC 共有三个标签页：

- **治理** — EA 原则与 Architecture Decision Records（ADR）。
- **风险** — TOGAF 阶段 G 的[风险登记册](risks.md)。
- **合规** — 之前位于 TurboLens 的按需扫描器（CVE + 法规差距分析）。

任意标签页都可以通过 `/grc?tab=governance`、`/grc?tab=risk` 或 `/grc?tab=compliance` 直接深链。

![GRC — 治理标签页](../assets/img/zh/52_grc_governance.png)

## 治理

并排两个面板：

- **原则** — 元模型中已发布 EA 原则的只读浏览器（声明、依据、影响）。请在「管理 → 元模型 → 原则」中编辑目录。
- **决策** — Architecture Decision Records。每条 ADR 记录状态、背景、决策、所考虑的备选方案以及后果。由 TurboLens Architect 向导生成的决策以草稿形式落入此处，供审查者签发。

## 风险

![GRC — 风险登记册](../assets/img/zh/53_grc_risk_register.png)

嵌入 TOGAF 阶段 G 的**风险登记册**。完整的生命周期、状态工作流、矩阵切换与责任人行为详见[风险登记册指南](risks.md)。要点如下：

- 登记册位于 `/grc?tab=risk`（此前位于 EA 交付下）。
- 风险可以手动创建，也可以从合规标签页的 CVE 或合规发现中**升级**而来。
- 升级是幂等的——发现一旦被升级，按钮即切换为「打开风险 R-000123」。

## 合规

![GRC — 合规扫描器](../assets/img/zh/54_grc_compliance.png)

按需的安全扫描器，由两个相互独立的部分组成：

- **CVE 扫描** — 针对当前生效景观中的供应商 / 产品 / 版本查询 NIST NVD，再由 LLM 对发现进行优先级排序。
- **合规扫描** — 针对启用的法规逐项进行 AI 差距分析。默认启用六个框架（EU AI 法、GDPR、NIS2、DORA、SOC 2、ISO 27001）；管理员可在[**管理 → 元模型 → 法规**](../admin/metamodel.md#compliance-regulations)中启用 / 禁用它们，也可以添加自定义法规（如 HIPAA、内部政策）。

发现在**重新扫描后依然持久** — 用户的判定、审查备注、用户对某张卡片的 AI 判定，以及到已升级风险的反向链接均会在后续扫描中保留。下一次扫描不再报告的发现会被标记为 `auto_resolved` 并默认隐藏；此前升级的风险保持不变，以免审计踪迹断裂。

合规网格镜像了清单网格：带列可见性切换、可持久化排序、全文搜索的过滤侧栏，以及以横向阶段时间线展示合规生命周期的明细抽屉：

```
new → in_review → mitigated → verified
                      ↘ accepted          （需要理由）
                      ↘ not_applicable    （范围复核）
                      ↘ risk_tracked      （晋升为风险时自动设置）
```

拥有 `security_compliance.manage` 时，勾选表头复选框可对当前过滤结果**全选**，然后通过粘性工具栏对所选发现执行**编辑决定**（批量过渡）或**删除**。非法过渡会在部分成功汇总中按行报告，因此单行错误不会让整批失败。完整动作参考见 [TurboLens → 安全与合规](turbolens.md#bulk-actions-on-the-compliance-grid)。

当从某发现晋升的风险被关闭或接受时，**该状态会自动回传到该发现** — 关联的合规行会切换为 `mitigated` / `verified` / `accepted` / `in_review`，以保持同步，无需手动维护。

### 单张卡片上的合规

合规扫描范围内的卡片会在其详情页上额外暴露一个**合规**标签页（由 `security_compliance.view` 控制）。它列出当前与该卡片关联的每条发现，并提供与 GRC 视图相同的「确认 / 接受 / **创建风险** / **打开风险**」操作——这样 Application Owner 即可在不离开卡片的情况下对自己的发现进行分诊。

## 权限

| 权限 | 默认角色 |
|------|----------|
| `grc.view` | admin、bpm_admin、member、viewer |
| `grc.manage` | admin、bpm_admin、member |
| `risks.view` / `risks.manage` | 参见[风险登记册 § 权限](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | 参见[TurboLens § Security & Compliance](turbolens.md) |

`grc.view` 控制 GRC 路由本身的可见性——若缺少该权限，顶部导航中的入口会被隐藏。每个标签页另外强制其领域专有权限，因而一名查看者可以阅读登记册而无法触发 LLM 扫描，举例而言。
