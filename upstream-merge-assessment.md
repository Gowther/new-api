# 上游合并难度评估报告

评估对象：`Gowther/new-api`（本地 fork，main @ `928f9a010`） ← `QuantumNous/new-api`（upstream/main @ `0ed497f06`）

评估方法：merge-base 分叉分析 + `git merge-tree` 内存试合并 + 临时 worktree 真实合并（Go 侧冲突取上游解）+ `go build ./...` 编译验证。全程未改动主工作区。

## 一、总体结论

**难度评级：中高。可合并，但不是"解冲突就能走"的常规同步，核心难点在前端，不在后端。**

| 维度 | 结论 |
|---|---|
| Go 后端 | **低-中**。文本冲突面小（22 文件/47 块），实测整库仅 2 个 fork 专属文件编译失败，移植路径明确 |
| 前端 | **高**。上游已完成"单前端化"：`web/default` → `web/`、`web/classic` 整目录删除。本地双前端各有约 50 个提交、+2 万行定制的维护模式被上游终结，需要做战略决策 |
| 预估工作量 | 4~7 个工作日（含回归测试），前提是接受放弃 `web/classic` |

分叉基线：merge-base `becc18e30`（2026-07-07），分叉约 8 周。本地领先 240 提交，落后 203 提交（上游约 25 提交/周的节奏，拖得越久越贵）。

## 二、双方变更画像

| | 本地 (240 commits) | 上游 (203 commits) |
|---|---|---|
| 变更文件数 | 344 | 2422 |
| 行数 | +59,050 / −3,758 | +142,664 / −170,438 |
| 大头 | web 231、controller 34、model 32、service 10 | web 1597、relay 203、relaykit(新) 151、controller 77、service 71 |
| 主题 | channels/models 管理增强、error-workbench/error-briefing、usage-logs 增强、batch redemption userscripts、双前端同步维护 | relaykit 协议转换层独立（#6770 系列）、hosted-tool 保真（#7137）、Sub2API 渠道、`/v1/alpha/search`（Codex 独立搜索）、web/classic 删除与单前端化、model list 更新 |

两侧都改过的文件（文本冲突候选区）：104 个。

## 三、结构性变化（决定难度上限的两件事）

### 1. 上游 relaykit 抽取（后端）
上游把协议转换层抽成独立 `relaykit/` 包（151 个新文件），`dto/` 部分类型迁往 `relaykit/dto/`（如 `dto/channel_settings.go` 删除 → `relaykit/dto/channel_settings.go`，`dto/openai_request.go` 流出 1069 行）。本地 `dto/` 有 5 个文件定制，其中 `channel_settings.go` 被上游删除，是唯一 modify/delete 级 Go 冲突。

### 2. 前端单前端化（最高权重项）
- 上游 `web/default` → `web/`（目录改名），`web/classic` 在 `31d70fca3` 一带被**整目录删除**。
- 本地 `web/default`：50 commits，142 文件，+20,614 行；`web/classic`：50 commits，89 文件，+19,739 行。
- 本地工作区 AGENTS.md 强制"双前端同步"规则——合并后该规则与上游现实直接冲突，AGENTS.md 本身也是冲突文件，需一并改写。

## 四、试合并实测结果

`git merge-tree --write-tree` + 临时 worktree 真实合并：**155 个文件未自动合并**。

### Go 后端（22 个内容冲突文件 / 47 个冲突块）

| 冲突块数 | 文件 |
|---|---|
| 8 | controller/channel-test.go |
| 5 | setting/operation_setting/monitor_setting.go、model/channel.go |
| 4 | controller/model_list_test.go |
| 3 | service/channel_select.go、model/channel_cache.go、middleware/distributor.go |
| 1-2 | ability/main/log/pricing(model)、relay.go/option.go/log.go/user.go(controller)、api-router(router)、channel_affinity(service)、monitor_setting_test、distributor_test(add/add)、channel_test_internal_test |

本地在这 22 个文件上有 +2,902/−330 行定制需与上游重写融合。

### Go 语义冲突（编译实测，Go 冲突取上游解后 `go build ./...`）

依赖全部可解析（go.mod/go.sum 自动合并成功），整库编译仅 2 个 fork 专属文件失败：

1. `model/error_log_folding.go`（10 处报错）——依赖本地加在 `model/log.go` 里的 `ErrorLogSummaryItem` / `errorSummarySeverityRank`。**修法**：把这些类型/函数重新植入上游重写后的 `model/log.go`。
2. `model/channel_satisfy.go`（1 处报错）——`dto.ChannelOtherSettings` 已迁至 `relaykit/dto/channel_settings.go`。**修法**：改 import。

58 个 fork 专属 Go 文件（controller 18、model 17、service 5、setting 5、其余）其余全部原样可用，移植成本低。

### 前端（133 个冲突文件 / 479 个冲突块）

| 类别 | 数量 | 定级 |
|---|---|---|
| i18n locale JSON（web/src）| 7 文件 / 396 块 | **低**——机械合并，重跑 `bun run i18n:sync` + 补 fork 新 key 翻译 |
| `routeTree.gen.ts` | 21 块 | **零**——生成物，重新生成即可 |
| feature 逻辑内容冲突（channels/keys/pricing/usage-logs/system-settings/playground）| 27 文件 / ~60 块，最大 common-logs-columns 9 块、channel-mutate-drawer 8 块 | **中**——需逐块理解上游重写后结构，是前端真正的手工活 |
| file-location（fork 在 `web/default/*` 新增的文件落入被改名目录）| 34 文件 | **低-中**——移动到 `web/` 新路径 + import/引用修正，机械但量大 |
| modify/delete（`web/classic/*`，上游已删、本地改过）| 64 文件 | **战略决策**，见下 |
| directory rename split | 2 处（classic helpers、default console 路由）| 随 classic 决策一并处理 |

### 其他
- `AGENTS.md`：冲突（前端双前端规则段落需按 classic 决策改写）。
- `userscripts/`（batch redemption）：完全独立，零冲突。
- `main.go` `go:embed web/dist`：构建产物问题，非合并问题。

## 五、`web/classic` 决策（唯一的战略题）

- **方案 A：跟随上游放弃 classic（推荐）**。本地 classic 定制（error-workbench/error-briefing 的 classic 侧等 ~20k 行）随目录删除一并退役，64 个 modify/delete 直接 `git rm`。工作区 AGENTS.md 的双前端同步规则删除。代价：classic 入口的功能回退需确认无生产用户依赖。
- **方案 B：在 fork 内重建 classic**。等于长期背负一条上游不再维护的前端线，且本地 classic 定制要对抗上游 API/UI 结构漂移持续重移植。不建议。

## 六、工作量与方案

| 方案 | 估算 | 评价 |
|---|---|---|
| **merge upstream/main 进 main（推荐）** | Go 侧解冲突+移植 0.5~1 天；前端 default 侧（27 逻辑文件 + 34 搬迁 + i18n）2~4 天；classic 清理与 AGENTS.md 0.5 天；后端回归（计费不变量、三数据库）+ 前端构建验收 1 天。**合计 4~7 个工作日** | 一次到位，保留历史 |
| rebase 240 commits | 冲突面 × 240 | 不可行 |
| 在上游之上重建 fork、按功能组重放 | 前期与 merge 相当，后续得到干净基线 | 若打算长期维护 fork，可作为 merge 后的二期收敛目标 |

功能组清单（重放/回归时按组验收）：channels 管理 UX 群（quick mapping、paste、cc-switch、routing override、official price sync）、error-workbench + error-briefing、usage-logs 增强、model/channel 后端群（channel_select/affinity、satisfy、monitor settings、error log folding、upstream update）、userscripts（已独立）。

## 七、风险清单

1. **relaykit 语义漂移**：#7137 重构了 usage 合并/billing usage sidecar/hosted-tool 生命周期。本地 error-briefing、usage-logs 对 usage 字段（含 `reasoning_content` 提取等本地 fix）的消费方式需回归验证。
2. **渠道调度叠加**：本地 channel_select/affinity/monitor 定制与上游同期改动（Codex model discovery #6184、Sub2API、alpha search 计费）在同一批文件上，需联合回归。
3. **计费安全不变量**（AGENTS.md 强制）：合并引入的 alpha search tool 计费、cache_write 计费等新路径，需确认与本地 quota 数学/饱和审计机制无冲突，三数据库（SQLite/MySQL/PG）跑一遍迁移。
4. **i18n**：fork 新增 key 需补 fr/ru/ja/vi/zh-TW 翻译；classic 语言包随决策废弃。
5. **时间窗**：上游 8 周 203 commits 的节奏下，每拖一个月合并成本近似线性上升；#7137 级别的大重构落地后，越晚合语义漂移越大。

## 八、建议执行顺序（如批准合并）

1. 建 `merge-upstream-202609` 分支，`git merge upstream/main`。
2. 先解 Go 侧 22 文件（多数低难度，channel-test.go 与 monitor_setting.go 留足时间），重植入 `model/log.go` 本地类型，改 `channel_satisfy.go` import，`dto/channel_settings.go` 定制并入 `relaykit/dto/channel_settings.go`；`go build ./...` + `go test ./...` 全绿。
3. 前端：先跑 `i18n:sync` 重生成 locale 与 routeTree，再手合 27 个逻辑文件、搬迁 34 个新增文件。
4. classic 决策落地（推荐 `git rm` + AGENTS.md 改写）。
5. 回归：计费路径冒烟（billingexpr/quotas）、三库迁移、bun build + 关键页面人工验收。
