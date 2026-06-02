# Agent 项目上下文

**最后更新：** 2026-06-02

## 目标与约束

- Vite + React 任务看板；核心状态持久化到 **Netlify Functions + Blobs**（整站 JSON，key=`main`）。
- **默认无需 `.env`**：`src/cloudSync.js` 内置 Netlify 生产 API 地址；GitHub Pages 也走该地址；可用 `VITE_CLOUD_API_URL` 覆盖。
- 多人协作：首次加载拉全量；**12 秒 meta 轮询** + 切页/网络恢复立即拉取；保存前 merge + 乐观锁（409 冲突重试）。
- 可选鉴权：Netlify 设 `APP_STATE_TOKEN`，前端 `.env` 设 `VITE_CLOUD_APP_TOKEN`（须一致）。

## 云端 API

- 函数：`netlify/functions/app-state.mjs`
- GET 全量 / `?meta=1` 轻量轮询；PUT 带 `expected_updated_at`；上限约 5.5MB。
- 合并逻辑：`src/collabMerge.js`（出站 `mergeCollaborativeState` / 入站 `mergeInboundCollaborativeState`）。

## 部署

- `npm run deploy:netlify` — Netlify 站点 + Functions
- `npm run deploy:pages` — GitHub Pages + Gitee（`tutuai-pages` 子目录）
- `npm run deploy:source` — 推送源码分支
- `npm run deploy:all` — 以上全部

## 已知产品限制

- 整份 JSON 单行存储，体积上限约 5.5MB；附件 Base64 内嵌，>8MB 只存元数据。
- 无 Realtime，协作延迟约 12 秒；同一字段并发改仍可能后写胜出。
- 未配置 Token 时 API 无鉴权；用户密码明文存在 JSON 中（前端比对）。

## 历史

- 2026-05：曾用 Supabase（国内不可达，已弃用）。遗留 SQL：`supabase/setup-app_state.sql`。
