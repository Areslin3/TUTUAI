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
- **云端（混合存储）**：
  - **主状态 JSON**（Netlify Blobs `tutu-app-state` / key `main`）：任务、用户、留言元数据、附件引用（`storage: blob` + `blobKey`）。
  - **附件 Blob**（`tutu-app-attachments` / key `att:{id}`）：单文件 ≤4MB，与主 JSON 分离，避免 5.5MB 整包上限。
  - 写入前自动备份上一版到 `main:backup:latest`。
- **机制**：保存前 merge → 大附件迁移到独立 Blob → 主 JSON 剥离 dataUrl → 乐观锁 PUT；12 秒轮询；切页/网络恢复拉取。

默认 API：

```
https://beautiful-basbousa-c7556d.netlify.app/.netlify/functions/app-state
https://beautiful-basbousa-c7556d.netlify.app/.netlify/functions/app-attachments?id={附件ID}
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

1. 右上角须显示 **「云端已同步」**（失败时点 **重试**）。
2. 任务详情须点 **「提交上传」** 或留言区的 **「提交留言与附件」**（只选文件不会同步）。
3. 等约 **12 秒** 轮询，或刷新页面。
4. 单文件 **>4MB** 无法上传至附件 Blob；主 JSON 仍约 **5.5MB** 元数据上限。
5. 旧版 inline Base64 附件会在下次保存时自动迁移到独立 Blob（>48KB）。

**GitHub push 失败（443 连接重置）**

- 网络波动，稍后重试 `git push origin fix/sync-black-screen`。

## 安全提醒

默认云端 API **无鉴权**。若需收紧访问：

1. Netlify 环境变量：`APP_STATE_TOKEN=你的密钥`
2. 构建时 `.env`：`VITE_CLOUD_APP_TOKEN=同一密钥`
3. 重新 `npm run deploy:netlify` 与 `npm run deploy:pages`

仍建议仅在可信团队使用；大附件应迁至对象存储。

## 历史说明

旧版曾使用 Supabase（`*.supabase.co` 国内不可达已弃用）。遗留 SQL 见 `supabase/setup-app_state.sql`，当前生产环境不使用。
