你必须按照目前的md文件详细执行我们的代码修改计划，且必须时刻关注，维护本次md文档，确保该文档能始终保持最新，和我们代码库保持完全一致，除非用户要求，否则默认禁止打补丁，禁止兼容层，我们需要的是简洁干净可扩展的系统，我们这个系统目前没有人用，可以一次性全量，彻底，不留遗留的修改，并且需要一次性完成所有，禁止停下，禁止自己停止任务，一次性完成所有内容。

# 1:项目目标

## 核心目标
- 统一所有 AI 任务到单一运行时：`LangGraph + AI SDK + MySQL Checkpointer`。
- 保留非 AI 接口现状，避免无效改造。
- 统一状态、重试、取消、回放、日志、错误语义，消除多套执行模型冲突。

## 为什么做
- 目前系统存在多套执行与状态模型并行，导致：
  - 步骤状态覆盖/错位/重复。
  - 重试层级打架（队列重试、步骤重试、解析重试）。
  - 前端需要补丁式归并逻辑（如 stepId 重试后缀解析）。
  - 故障定位成本高。

## 强约束（必须满足）
- A. State 瘦身：State 只存 metadata 和 DB refs，不存大文本正文。
- B. 逻辑时钟：`graph_events.seq` 单调递增；前端发现跳号即补拉 `afterSeq`。

## 修改前后预期
- 修改前：任务执行、流式事件、回放与状态聚合分散在多层。
- 修改后：统一 Run Runtime，单一事实源，统一事件协议与恢复机制。

## 预计改动规模（动态更新）
- 预计文件：75-105
- 预计代码行：8000-13000
- 当前已改动文件：26（本轮累计，含 runtime/service/bridge/worker/前端运行钩子/回归测试/文档集）

# 2:阶段+具体代码修改地方以及需要修改的内容

## 阶段总览状态
- ✅ Phase 1: 架构决策已锁定（LangGraph + AI SDK + MySQL Checkpointer；AI 全量统一，非 AI 不改）
- ✅ Phase 2: 主控文档建立并进入持续维护
- ✅ Phase 3: Runtime 骨架 + Prisma graph_* 模型
- ✅ Phase 4: Run API（/api/runs）
- ✅ Phase 5: 事件 seq 逻辑 + 前端跳号补拉
- 🔄 Phase 6: AI SDK 统一层（核心链路已切，长尾任务待收口）
- 🔄 Phase 7: GraphExecutor + QuickRunGraph/PipelineGraph（已落地并接入核心链路）
- 🔄 Phase 8: 复杂链路迁移（story_to_script_run / script_to_storyboard_run）
- ⏸ Phase 9: 其余 AI 任务全量迁移
- 🔄 Phase 10: 清理旧执行路径与旧事件协议（代码清理持续进行）
- ⚠️ Phase Risk: 一次性切换风险高，必须严格按阶段门禁推进

## Phase 2（当前执行中）主控文档
- 🔄 任务：创建并维护唯一执行文档
  - 路径：`docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md`
  - 要求：每次代码变更后先更新本文件状态，再继续下一步。

## Phase 3 运行时骨架与数据模型
- ✅ 任务：新增 Prisma 模型与索引
  - 文件：`prisma/schema.prisma`
  - 新增：`graph_runs`, `graph_steps`, `graph_step_attempts`, `graph_events`, `graph_checkpoints`, `graph_artifacts`
  - 要求：
    - `graph_events` 包含 `seq`，并约束 `(run_id, seq)` 唯一。
    - `graph_runs` 包含 `last_seq` 以支持 run 内递增序列。
    - `graph_runs.taskId` 建立唯一映射（run <-> task），用于取消与追踪。
- ✅ 任务：新增 Run 类型与服务
  - 文件：`src/lib/run-runtime/types.ts`
  - 文件：`src/lib/run-runtime/service.ts`
  - 文件：`src/lib/run-runtime/publisher.ts`
  - 文件：`src/lib/run-runtime/task-bridge.ts`
  - 文件：`src/lib/run-runtime/workflow.ts`
  - 能力：
    - createRun/getRun/requestCancel/listEventsAfterSeq/appendEventWithSeq
    - run event publish + task event bridge
    - State 大小守卫（64KB）
- ⚠️ 风险：DDL 与现有高并发表并存，需控制迁移窗口与索引创建顺序。

## Phase 4 Run API
- ✅ 任务：新增运行接口
  - `src/app/api/runs/route.ts` -> `POST /api/runs`, `GET /api/runs`
  - `src/app/api/runs/[runId]/route.ts` -> `GET /api/runs/:runId`
  - `src/app/api/runs/[runId]/events/route.ts` -> `GET /api/runs/:runId/events?afterSeq=`
  - `src/app/api/runs/[runId]/cancel/route.ts` -> `POST /api/runs/:runId/cancel`

## Phase 5 逻辑时钟与跳号补拉
- ✅ 任务：运行时事件序列
  - 文件：`src/lib/run-runtime/service.ts`
  - 要求：事务内分配 seq、写事件、更新 run.last_seq。
- ✅ 任务：worker 事件 runId 透传
  - 文件：`src/lib/workers/shared.ts`
  - 说明：`withFlowFields` 已统一注入 `runId`（来自 payload/meta），确保 processing/progress/stream/completed/failed 全链路可桥接到 run 事件。
- ✅ 任务：task->run 事件桥接增强（progress 感知）
  - 文件：`src/lib/run-runtime/task-bridge.ts`
  - 说明：`task.progress` 事件已支持基于 `stage/done/error` 推导 `step.complete/step.error`，并统一 `stepKey`、`attempt`、lane 解析规则；stream 场景增加默认 `step:${taskType}` 键防止丢片段。
- ✅ 任务：run/step 终态投影收敛
  - 文件：`src/lib/run-runtime/service.ts`
  - 说明：`run.complete/run.error/run.canceled` 会批量收敛未终态 step；并完善错误消息解析（含嵌套 error.message）与运行中状态推进，减少“run 终态但 step 仍 running”矛盾。
- ✅ 任务：桥接规则回归测试
  - 文件：`tests/unit/run-runtime/task-bridge.test.ts`
  - 覆盖：stream lane 归一、stream 缺失 stepId 的 fallback stepKey、processing done/error 推导、completed 映射、缺失 runId 拦截。
- 🔄 任务：前端消费路径切入 run seq 拉取
  - 文件：`src/lib/query/hooks/run-stream/run-request-executor.ts`
  - 说明：当接口返回 `runId` 时，前端优先走 `/api/runs/:runId/events?afterSeq=` 递增拉取，按 seq 单调推进；task SSE 保留为无 runId 场景兜底。
- ✅ 任务：run events 拉流路径单测
  - 文件：`tests/unit/helpers/run-request-executor.run-events.test.ts`
  - 覆盖：`async + runId` 返回后改走 `/api/runs/:runId/events` 并产出终态。
- ✅ 任务：state-machine 保留 run.start payload
  - 文件：`src/lib/query/hooks/run-stream/state-machine.ts`
  - 说明：`run.start` 事件会落盘 payload，后续恢复和调试可读取 `taskId/runId` 元信息。
- 🔄 任务：前端消费顺序保障
  - 文件：`src/lib/query/hooks/run-stream/*`（将迁移到 RunStoreV2）
  - 要求：发现 seq 跳号即补拉并去重。
- ✅ 任务：story/script 前端运行流改为 run-event 单通道
  - 文件：
    - `src/lib/query/hooks/run-stream/run-request-executor.ts`
    - `src/lib/query/hooks/run-stream/recovered-run-subscription.ts`
    - `src/lib/query/hooks/run-stream/run-stream-state-runtime.ts`
    - `src/lib/query/hooks/useStoryToScriptRunStream.ts`
    - `src/lib/query/hooks/useScriptToStoryboardRunStream.ts`
    - `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceExecution.ts`
    - `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useNovelPromotionWorkspaceController.ts`
  - 说明：移除 story/script 的 task SSE 兜底，恢复与执行统一为 `/api/runs/:runId/events` 轮询与 seq 补拉；停止动作改为 `/api/runs/:runId/cancel`。
- ⚠️ 风险：实时流与补拉流重复事件导致状态回退，必须基于 seq 去重。

## Phase 6 AI SDK 统一调用层
- ✅ 任务：新增 AI Runtime 基础层
  - 目录：`src/lib/ai-runtime/`
  - 文件：
    - `src/lib/ai-runtime/types.ts`
    - `src/lib/ai-runtime/errors.ts`
    - `src/lib/ai-runtime/client.ts`
    - `src/lib/ai-runtime/index.ts`
  - 能力：统一 step 调用、错误归一、usage 输出结构。
- 🔄 任务：核心链路 handler 切换到 AI Runtime
  - 文件：
    - `src/lib/workers/handlers/story-to-script.ts`
    - `src/lib/workers/handlers/script-to-storyboard.ts`
- ✅ 任务：长尾文本 handler 批量切换到 AI Runtime（第一批）
  - 文件：
    - `src/lib/workers/handlers/analyze-global.ts`
    - `src/lib/workers/handlers/analyze-novel.ts`
    - `src/lib/workers/handlers/voice-analyze.ts`
    - `src/lib/workers/handlers/screenplay-convert.ts`
    - `src/lib/workers/handlers/clips-build.ts`
    - `src/lib/workers/handlers/episode-split.ts`
    - `src/lib/workers/handlers/asset-hub-ai-modify.ts`
    - `src/lib/workers/handlers/character-profile.ts`
- ⚠️ 风险：仍有少量旧 `llm-client` 直连点（如 shot 系列/text.worker/storyboard-phases），需继续收口。

## Phase 7 Graph 执行器与模板
- ✅ 任务：实现 GraphExecutor（checkpoint/retry/cancel/timeout）
  - 文件：`src/lib/run-runtime/graph-executor.ts`
- ✅ 任务：实现 QuickRunGraph（单节点简单任务）
  - 文件：`src/lib/run-runtime/quick-run-graph.ts`
- ✅ 任务：实现 PipelineGraph（复杂链路模板）
  - 文件：`src/lib/run-runtime/pipeline-graph.ts`
- ✅ 任务：GraphExecutor 单测
  - 文件：`tests/unit/run-runtime/graph-executor.test.ts`
- ⚠️ 风险：旧 `_r2` 等语义必须彻底移除，禁止新旧混用。

## Step Identity 统一（阶段内子任务）
- ✅ 任务：消除动态 `stepId_retry_x` 语义，统一为 `stepId` 固定 + `stepAttempt` 递增
  - 已完成文件：
    - `src/lib/workers/handlers/clips-build.ts`
    - `src/lib/workers/handlers/screenplay-convert.ts`
    - `src/lib/workers/handlers/voice-analyze.ts`
    - `src/lib/workers/handlers/episode-split.ts`
    - `src/lib/novel-promotion/story-to-script/orchestrator.ts`

## Phase 8 复杂链路迁移（核心）
- ✅ 任务：`story_to_script_run` worker 主路径接入 PipelineGraph 执行器
  - 文件：`src/lib/workers/handlers/story-to-script.ts`
- ✅ 任务：`script_to_storyboard_run` worker 主路径接入 PipelineGraph 执行器
  - 文件：`src/lib/workers/handlers/script-to-storyboard.ts`
- ⏸ 任务：把“台词分析”固定建模为分镜链路步骤
- ⚠️ 风险：产物写入幂等与回放一致性

## Phase 9 其余 AI 任务迁移
- ⏸ 任务：图像/视频/音频/资产中心 AI 任务统一纳管
- ⚠️ 风险：任何 AI route 不允许旁路旧执行路径

## Phase 10 清理与收口
- ⏸ 任务：切换所有 AI 提交入口到 createRun
- ⏸ 任务：下线旧 AI worker 执行路径与旧 task-stream 事件写入
- ⏸ 任务：清理死代码和旧类型
- ✅ 任务：补全运行时重构文档集与 README 入口
  - 新增目录：`docs/ai-runtime/`
  - 新增文件：
    - `README.md`
    - `01-architecture.md`
    - `02-data-model.md`
    - `03-event-protocol.md`
    - `04-api-contract.md`
    - `05-migration-playbook.md`
    - `06-operations-runbook.md`
    - `07-testing-acceptance.md`
    - `08-open-gaps.md`
  - 更新：`README.md` 添加文档入口
- ⚠️ 风险：漏删；需关键字全仓扫描验收

# 4:验证策略

## 可量化目标
- 状态一致性：
  - 0 次出现“左侧已完成但主面板仍在流式输出”的矛盾状态。
  - 0 次出现步骤重复膨胀/覆盖错位。
- 恢复能力：
  - 刷新恢复完整率 100%（同一 run）。
  - 人工制造 seq 跳号后，1 次补拉内恢复完整。
- 稳定性：
  - 可重试错误均按策略重试；不可重试错误显式failed。
- 观测：
  - 每条关键日志含 `runId/stepKey/attempt`。

## 验证方式
- 单测：runtime、event seq、state guard、error mapping。
- 集成：story_to_script_run、script_to_storyboard_run 的成功/failed/重试路径。
- 回归：`npm run test:regression` 全绿。

## 当前验证执行记录（持续追加）
- ✅ `npx vitest run tests/unit/run-runtime/task-bridge.test.ts`
- ✅ `npx vitest run tests/unit/run-runtime/task-bridge.test.ts tests/unit/helpers/run-stream-state-machine.test.ts`
- ✅ `npx vitest run tests/unit/helpers/run-request-executor.run-events.test.ts tests/unit/run-runtime/task-bridge.test.ts tests/unit/helpers/run-stream-state-machine.test.ts`
- ✅ `npx vitest run tests/unit/helpers/run-request-executor.run-events.test.ts tests/unit/helpers/recovered-run-subscription.test.ts tests/unit/run-runtime/graph-executor.test.ts`
- ✅ `npm run build`
- ✅ `npm run test:regression` guard 阶段已通过（含新增 run routes catalog）
- ⚠️ `npm run test:regression` 二次执行阻塞于仓库现有单测failed（与本轮 runtime 改造文件无直接耦合）：
  - `tests/unit/optimistic/task-target-overlay.test.ts`（2 failures）
  - `tests/unit/billing/cost-error-branches.test.ts`（1 failure）
- ✅ `npm run build`（含 run-request-executor 改造后再次通过）

## 当前问题登记（必须先记录再推进）
- ⚠️ 回归门禁未全绿：存在 3 个历史/并行改动引入的failed用例，导致 `test:regression` 无法通过。
- ⚠️ 本地构建环境 Redis 未监听 `127.0.0.1:16379`，`next build` 期间出现大量连接拒绝日志，但构建产物仍成功输出。

# 5:备注
- 本文档是唯一执行来源，必须与代码库保持同步。
- 禁止隐式回退、禁止兼容层、禁止静默吞错。
- 若遇阻塞，必须先登记到 `⚠️ 问题` 再继续可执行项。
