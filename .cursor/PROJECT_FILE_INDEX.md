# 项目文件索引

**最后更新：** 2026-05-07

| 路径 | 职责 |
|------|------|
| `src/App.jsx` | 主界面、任务/留言/附件、云端 hydrate + Realtime + 轮询合并 |
| `src/cloudSync.js` | Supabase 客户端、默认内嵌 URL/anon key、fetch/save、Realtime 订阅 |
| `src/storage.js` | localStorage 状态与会话 |
| `src/constants.js` | 模块、状态等常量 |
| `supabase/setup-app_state.sql` | 建表 + RLS（新项目在 Supabase SQL Editor 执行一次） |
| `scripts/copy-entry.mjs` | 构建后复制入口（见 `package.json` scripts） |

检索：业务逻辑以 `App.jsx` 为主；同步行为以 `cloudSync.js` 为准。
