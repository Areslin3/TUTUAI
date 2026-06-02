# 兔兔及时达自动化部署进度查询系统

内部任务看板：模块任务、SOP 附件、留言协作、回收站与进度追踪。

## 线上地址

| 渠道 | 地址 | 说明 |
|------|------|------|
| Netlify（推荐） | https://beautiful-basbousa-c7556d.netlify.app | 含云端同步 API，国内可访问 |
| GitHub Pages | https://areslin3.github.io/TUTUAI/ | 静态站点，同步走 Netlify API |
| 源码 | https://github.com/Areslin3/TUTUAI/tree/fix/sync-black-screen | React 源码分支 |

## 数据与同步

- **本地**：浏览器 `localStorage` 缓存，离线可浏览已加载数据。
- **云端**：Netlify Functions + Blobs，单行 JSON 存整站状态（任务、用户、留言、附件 Base64、回收站）。
- **机制**：保存前拉取合并 → 乐观锁写入；12 秒轮询；切回页面/网络恢复时立即拉取；冲突自动重试；失败可点右上角「重试」。

默认云端 API：

```
https://beautiful-basbousa-c7556d.netlify.app/.netlify/functions/app-state
```

可选 `.env` 覆盖（见 `.env.example`）：

```env
VITE_CLOUD_API_URL=https://your-site.netlify.app/.netlify/functions/app-state
```

## 本地开发

```bash
npm install
npm run dev
```

```bash
npm run build      # 生产构建 → dist/
npm run preview    # 预览 dist/
```

## 一键部署

在项目根目录 PowerShell 执行：

```powershell
# 部署 Netlify（站点 + 云端 API）
npm run deploy:netlify

# 部署 GitHub Pages + Gitee
npm run deploy:pages

# 推送源码到 GitHub
npm run deploy:source

# 以上全部（Netlify + Pages + 源码推送）
npm run deploy:all
```

## 仓库分支说明

| 分支 | 内容 |
|------|------|
| `fix/sync-black-screen` / `source` | React 源码 |
| `main`（由 `tutuai-pages` 推送） | GitHub Pages 静态构建产物 |

**注意**：不要把源码直接合并进 `main`，否则会破坏 Pages 站点。

## 常见问题

**右上角「同步失败 / Failed to fetch」**

1. 使用 Netlify 地址或 GitHub Pages 均可，但需 **Ctrl+F5** 强刷。
2. 点右上角 **「重试」**。
3. 确认 Netlify 函数可访问：  
   `https://beautiful-basbousa-c7556d.netlify.app/.netlify/functions/app-state?meta=1`

**附件上传后别人看不到**

- 等约 12 秒轮询，或刷新页面。
- 大附件（>8MB）不会写入 `dataUrl`，仅保留文件名元数据。
- 整站 JSON 超过约 5.5MB 会同步失败，需删除部分附件。

**GitHub push 失败（443 连接重置）**

- 网络波动，稍后重试 `git push origin fix/sync-black-screen`。

## 安全提醒

当前为内部协作工具，云端 API **无鉴权**。仅建议在可信团队使用；公网长期使用需加 Token 鉴权，并将大附件迁至对象存储。

## 历史说明

旧版曾使用 Supabase（`*.supabase.co` 国内不可达已弃用）。遗留 SQL 见 `supabase/setup-app_state.sql`，当前生产环境不使用。
