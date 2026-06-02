# 项目文件索引

**最后更新：** 2026-06-02

| 路径 | 职责 |
|------|------|
| `src/App.jsx` | 主界面、任务/留言/附件、云端 hydrate + 轮询 + persist 队列 |
| `src/cloudSync.js` | Netlify 云端 API、fetch/save、重试与冲突错误 |
| `src/collabMerge.js` | 多人协作 merge（出站/入站方向不同） |
| `src/storage.js` | localStorage 状态与会话 |
| `src/constants.js` | 模块、状态等常量 |
| `netlify/functions/app-state.mjs` | 云端 CRUD + 乐观锁 + 可选 Token 鉴权 |
| `netlify.toml` | 构建、Functions、/api/app-state 重定向 |
| `scripts/deploy-pages.ps1` | 构建并推 GitHub Pages + Gitee |
| `scripts/deploy-source.ps1` | 推送源码分支 |
| `scripts/deploy-all.ps1` | 一键全量部署 |
| `scripts/copy-entry.mjs` | 构建后复制入口 HTML |

检索：业务逻辑以 `App.jsx` 为主；同步行为以 `cloudSync.js` + `collabMerge.js` 为准。
