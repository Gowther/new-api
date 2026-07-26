# 上游可单挑移植清单（按功能/修复点）

评估方式：对上游 197 个非 merge 提交筛选出 ~80 个后端候选，在临时 worktree 逐个 `git cherry-pick --no-commit` 试 apply，测真实冲突；干净的 33 个再按上游时间顺序叠加并 `go build ./...` 验证编译。主仓库未动。

**核心结论：33 个提交可原样干净 apply 且叠加后整库编译零错误（合计 102 文件 +3734 行）；另有约 15 个只需 1-2 处手工融合；真正的硬骨头只有 5-6 个（relaykit 时代提交和前端大改）。**

难度定义：
- **低** = cherry-pick 无冲突，叠加编译通过，基本不用动
- **低-中** = 无冲突或仅 1-2 处小冲突（测试文件/机械行），需一次人工确认
- **中** = 冲突落在你定制过的文件（model/channel.go、text_quota、router 等），需理解双方意图融合；或存在依赖链要先补
- **中-高 / 高** = 依赖 relaykit 重构、上游提交链、或前端目录改名（web/src vs 本地 web/default/src），单挑不划算

---

## A. Codex / 你点名的功能

| 提交 | 内容 | 难度 | 备注 |
|---|---|---|---|
| `dad57a6bb` | fix: sync codex field (#6018) | **低**（实测干净） | |
| `57746fc97` | feat: Codex 渠道上游模型自动发现 (#6184) | **低-中**（冲突仅 codex constants + 1 个测试文件） | 替代你本地写死的 ModelList |
| `2d23cdf29` | feat: **Codex 独立搜索 `/v1/alpha/search`** + 可配置工具计费 + Sub2API 渠道 | 全量：**中-高**（13 个冲突文件：dto/channel_settings.go 上游已删、text_quota 计费重写、web channels UI）；**最小移植（只做 alpha search 端点 + codex 转发 + 常规计费）：低-中**，约 6-8 个文件基本是新增 | 原始提交在 relaykit 抽取前一天，用的是旧 `dto` 包，与本地结构兼容。推荐做最小移植 |
| `398cdafec` | feat: New API 渠道类型支持 | **中-高** | 依赖 `2d23cdf29`（sub2api/alpha 文件），是链式提交 |

## B. 稳定性（强烈推荐，都是生产级痛点）

| 提交 | 内容 | 难度 |
|---|---|---|
| `1751f43ee` | fix(sqlite): WAL + busy timeout + _txlock=immediate，解决并发写锁死 (#7030) | **低**（实测干净） |
| `b518d0033` | fix(relay): 限制上游响应头等待时间，修复无界堆增长 → **OOM** (#6949) | **低-中**（仅 39 行，service/http_client.go 1 处冲突） |
| `6eb6f35ed` | fix(model): JSON 列 Valuer 返回 string，修 pg simple protocol | **低** |
| `bd585d78e` | fix(aws): 客户端断开时取消 Bedrock 请求 (#6589) | **低-中**（service/billing_usage.go 2 文件） |
| `b7017c251` | fix(model): no-op system task 状态写入不当作锁丢失 (#7135) | **低** |
| `4e570389d` | fix: 订阅重置改用 GORM v2 行锁 (#6057) | **低** |
| `ccd535ef8` | fix: 并发额度/状态更新加固 | **中**（model/channel.go、token.go、user_cache.go 都是你重度定制区） |
| `27ff6a876` | fix(model): 迁移旧 token key 约束 | **中-低**（model/main.go 1 处） |

## C. 计费正确性（与你的计费安全不变量方向一致）

| 提交 | 内容 | 难度 |
|---|---|---|
| `e926e5cac` | fix: 兑换码额度精度损失 (#6685) | **低**（实测干净；你正好有 batch redemption 功能） |
| `9a2d66031` | fix(users): 大额度值溢出防护 (#6134) | **低** |
| `27235a277` | fix: 建模同名不抹掉已有定价 (#6365) | **低** |
| `8c8c4153d` | fix(log): 用量统计保留 quota (#7108) | **低-中**（model/log.go 7 行 1 冲突块；log.go 是你的定制重区） |
| `58d4e9bd3` | fix(billing): 异步任务退款同步减 used_quota (#6795) | **低-中**（service/task_billing.go） |
| `f11641428` | fix: settle Responses cached token usage (#6892) | **低-中**（service/billing_usage.go） |
| `84a79b680` | fix: 上游错误消息解析为空时记录响应体 | **低**（对你 error-briefing 直接有用） |
| `3fbad6a72` | fix(price): 分层表达式预扣费默认 token 估算 | **低** |
| `d9595831b`+`621927f71` | fix(billing): 预扣费饱和拒绝 + 错误报告加固（配额链基石） | **中**（6 文件冲突：pkg/billingexpr/round.go、relay/helper/price.go、service/billing.go 等） |
| `50e5377ea`+`2a0ce3475`+`47ba9d2c6` | 充值原子结算 / 拒绝无法入账订单 / 钱包额度护栏 | **中**（本身干净或小冲突，但依赖上面的 `d9595831b` 配额链，需先补） |
| `48068ce92` | feat: OpenAI cache_write_tokens 按 cache-creation 计价 | **高**（11 个冲突文件含 service/relayconvert 整层漂移，单挑不划算） |
| `92d3c9d18` | fix: 未缓存部分按 prompt-max(cached,write) 封顶 | **中-高**（text_quota 等 6 文件） |

## D. 安全 / 账号

| 提交 | 内容 | 难度 |
|---|---|---|
| `b6b97a66e` | fix: 硬删除用户时清除认证数据 (#6168) | **低** |
| `0cd9dc85e` | **安全修复（GitHub 安全公告闭源补丁）**：model/user.go + router | **中**（2 文件冲突，但改动仅 117 行，值得做） |
| `d7992672a` | fix(oauth): 绑定时不覆盖用户状态 | **中**（controller/oauth.go 等 4 文件） |
| `e78e1db1e` | fix(oauth): 外来 window.opener 不当绑定流程（防 CSRF 类） | **中**（后端小；web 部分撞目录改名） |
| `918427d8a`+`b80d633cf` | feat(auth): 密码传输加密（可选开关） | **中-高**（后端+web auth+bun.lock，前后端成对） |
| `172114422` | fix(auth): 限流/刷新失败时保持登录态 | **中**（涉及上游新 web/src 路径） |

## E. 新功能（干净可直接拿）

| 提交 | 内容 | 难度 |
|---|---|---|
| `9724ef1b2` | feat: DeepSeek Responses API (#6562) | **低** |
| `cae3676ec` | feat: GLM 渠道 /v1/responses (#7050) | **低** |
| `ba2e9287b` | feat: Ollama 透传 Claude Messages + OpenAI Responses (#7051) | **低** |
| `08f88d25e` | feat: 腾讯 TokenHub（OpenAI 兼容协议）(#6232) | **低** |
| `85feb7a34` | feat(relay): 参数覆盖可用 user/group 上下文 (#6534) | **低** |
| `84834eee8` | feat(logs): 日志属主可见流状态 (#6558) | **低** |
| `0f9f668c6` | feat: zstd 请求解压 (#6545) | **低** |
| `97bbb7c8c` | feat(pricing): 动态定价组选择 | **低** |
| `1da23d6b3` | feat(rate-limit): access token/aff 转账关键路由限流 | **低-中**（router/api-router.go 1 处） |
| `a72e5082e` | feat: 系统信息-陈旧实例清理 (#5953) | **低-中**（后端干净，locale 6 处机械冲突） |
| `e99a9bd86` | feat: 渠道级 HTTP 传输控制 (#6847) | **中-高**（12 文件含 relaykit/dto） |

## F. 模型/渠道注册更新（保持模型目录不过期）

| 提交 | 内容 | 难度 |
|---|---|---|
| `6ce7305cd`+`2f5f6ba84` | GPT-5.6 系列 token 比率 + 5.6 准备 | **低** |
| `8b41defbe` | gemini-3-pro-image / gemini-3.1-flash-image GA (#6371) | **低** |
| `16bfae175` | GA 模型去掉 realtime beta header + 注册新模型 (#6032) | **低** |
| `3d5dc36f1` | 修复 Gemini 风格 /v1/models 列表 (#6199) | **低** |
| `e8596cab7` | 允许仅大小写不同的自定义模型名 | **低** |
| `a63364d15` | MiniMax vendor 识别 (#6164) | **低** |
| `823e26304` | Qwen TTS 模型分类 (#6711) | **低**（1 个 web 文件） |
| `2399de97d`/`93d2df85f`/`0bee5d441` | Ali: top_p 注入 / 图片模型映射协议 / 响应格式 | **低**（各 1 文件） |
| `8ad159a3b` | Ollama 保留 reasoning/tool-call 上下文 (#6605) | **低** |
| `7d09c6954` | prompt_cache_key chat→responses 传递 (#6861) | **低-中**（service/relayconvert 1 文件） |
| `1086038f5` | Responses→Chat 流式重复 tool call 修复 (#6225) | **低** |
| `0f2a2075a` | 请求参数校验错误返回 HTTP 400 (#6774) | **低** |
| `d49160f0e` | 后端长度校验 (#5548) | **低** |

## G. 不建议单挑（高 / 不可行）

- `0ed497f06` #7137 hosted-tool 保真大提交 —— 整个建立在 relaykit 上，等价于整体合并
- `253a74dd1` / `4442bb302` / `3dda1d50c` / `66ee6b8f9` —— relaykit 时代协议转换修复，本地无 relaykit
- `31d70fca3` auth 无状态 token 重构 —— 顺带删了 web/classic，牵一发动全身
- 纯前端修复（`df01273b9` 表格宽度、`28e0115a0` 浏览器翻译破坏 React、`8739c05c0` 列宽拖拽、`ab65d2582`、`394b023db` 等）—— 上游 `web/src` vs 本地 `web/default/src` 路径漂移 + 设计系统重写（7 月 11 日三个 design-system 提交），只能"按思路重做"，单个 0.5~1 天
- `eb48396d5` JS 插件系统任务适配器 —— 架构级特性

---

## 推荐打法

1. **第一批（半天，全低难度）**：B 组稳定性 5 个 + C 组低难度 5 个 + F 组全部 + D 组 `b6b97a66e`。实测可整体叠加编译通过，各自独立 cherry-pick 即可。
2. **第二批（1 天）**：Codex 三件套 —— `dad57a6bb`、`57746fc97`、alpha search 最小移植；顺手把 `84a79b680`（空错误体记日志，喂你的 error-briefing）带上。
3. **第三批（1 天，可选）**：配额链 `d9595831b`+`621927f71`，解锁充值三件套；安全组 `0cd9dc85e`、`d7992672a`。
4. 纯前端修复按需"重做"而非 cherry-pick；relaykit 时代提交全部放弃，等将来整体合并时一并解决。

注意事项：
- cherry-pick 后 `go build ./...` + 相关包 `go test` 必跑（上游部分提交带测试文件，个别测试冲突可直接取上游版）。
- `fc1259f58`（PriceData other ratios 重构）是纯重构，建议跳过，等整体合并。
- 涉及 model/main.go 迁移的提交（`27ff6a876`）在 SQLite/MySQL/PG 三库各验一次 AutoMigrate。
- 你 fork 的 AGENTS.md 计费规则（quota_math 集中制）与 `d9595831b` 的 strictQuota 助手同源，融合时保持 `common/quota_math.go` 单一入口。
