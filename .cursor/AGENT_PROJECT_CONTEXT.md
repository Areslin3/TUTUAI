# Agent 项目上下文

**最后更新：** 2026-06-02（混合 Blob + 多用户 LWW 合并）

## 目标与约束

- Vite + React 任务看板；持久化采用 **Netlify Functions + 双 Blob Store**（非传统 SQL 数据库）。
- **默认无需 `.env`**：`src/cloudSync.js` / `src/attachmentStorage.js` 内置生产 API；GitHub Pages 走 Netlify API；可用 `VITE_CLOUD_*` 覆盖。
- 多人协作：首次拉全量；**5 秒 meta 轮询** + **BroadcastChannel 多标签页** + 切页/网络恢复拉取；客户端与服务端 **LWW 合并**（冲突时服务端自动 merge）。

## 存储架构（最优实践：元数据与二进制分离）

| 层 | 技术 | 内容 |
|----|------|------|
| 主状态 | `tutu-app-state` / `main` | 任务、用户、留言、附件**元数据**（`storage`/`blobKey`，无 dataUrl） |
| 附件 | `tutu-app-attachments` / `att:{id}` | 单文件 dataUrl，≤约 4MB/个 |
| 备份 | `main:backup:latest` | 每次 PUT 主状态前写入上一版 |
| 本地 | localStorage | 可含 dataUrl 缓存，便于离线预览 |

函数：

- `netlify/functions/app-state.mjs` — GET/PUT 主 JSON
- `netlify/functions/app-attachments.mjs` — GET/PUT/DELETE 单附件

客户端：`src/cloudSync.js`、`src/attachmentStorage.js`、`shared/collabMerge.js`（`src/collabMerge.js` 再导出）

## 为何未采用 Yjs / Automerge（开源 CRDT）

- 需 WebSocket 常驻后端（y-websocket / Automerge-repo），与当前 Netlify Functions + Blobs 架构不匹配。
- 国内需自建同步节点；Supabase Realtime 已因不可达弃用。
- 当前规模下 **REST + 服务端 merge + 5s 轮询** 更稳、零额外成本；若未来要亚秒级协作再评估 PartyKit / y-sweet 自建。

- 曾用 Supabase：国内 `*.supabase.co` 不可达，已弃用（遗留 `supabase/setup-app_state.sql`）。
- 业界共识（S3/Blob + DB 元数据）：大文件不应塞进 JSON/关系库 BLOB 字段；Netlify 函数请求体硬限 **6MB**，整包 JSON 不可扩展。
- 当前团队规模 + 静态部署：Netlify Blobs 混合方案 **零额外数据库成本**、国内 Netlify 可达；若未来需 SQL/Realtime，优先考虑 **Cloudflare D1+R2** 或 **Turso+对象存储**（均需注意国内访问）。

## 已知限制

- 单附件 ≤4MB；主 JSON 元数据 ≤约 5.5MB。
- 无 Realtime WebSocket；协作延迟约 **5 秒**（同浏览器多标签页近即时）。
- 未配置 Token 时 API 无鉴权；密码明文存 JSON（前端比对）。

## 附件同步排查

1. 须点「提交上传」/「提交留言与附件」。
2. 右上角须「云端已同步」。
3. 新上传走独立 Blob；预览/下载会 lazy fetch `app-attachments`。
4. 旧 inline 附件 >48KB 在下次保存时自动迁移。
