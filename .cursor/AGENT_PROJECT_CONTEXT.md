# Agent 项目上下文

**最后更新：** 2026-05-07

## 目标与约束

- Vite + React 任务看板；核心状态可持久化到 Supabase 表 `app_state`（单行 `id = main`）。
- **默认无需 `.env`**：`src/cloudSync.js` 内置 `DEFAULT_SUPABASE_URL` / `DEFAULT_SUPABASE_ANON_KEY`；仍可用 `VITE_*` 覆盖。
- 多人协作：首次加载拉全量；**Realtime**（需 Supabase 对 `app_state` 开 Replication）+ **约 20s 轮询** `updated_at` 作兜底。

## Supabase 一次性配置

- SQL：`supabase/setup-app_state.sql`（RLS 允许匿名读/写该行；生产环境若需收紧需改策略）。
- Realtime：Dashboard → Database → Publications / Replication → 将 `app_state` 加入 `supabase_realtime`。

## 已知产品限制

- 整份 JSON 单行 upsert，**并发仍近似最后写入胜出**；Realtime/轮询仅缩短「看到别人改动」的延迟。
- 附件 Base64 进 `state`，体积大时留意 Supabase 单行 JSON 上限与性能。
