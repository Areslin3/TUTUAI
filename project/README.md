# 兔兔及时达自动化部署进度查询系统

## 已支持
- 本地模式（默认）：数据保存在浏览器 `localStorage`
- 云同步模式（Supabase）：多人实时共享同一份任务数据

## 1) Supabase 建表
在 Supabase 的 SQL Editor 执行：

```sql
create table if not exists public.app_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
```

## 2) 配置前端环境变量
复制 `.env.example` 为 `.env`，并填入你自己的项目信息：

```bash
cp .env.example .env
```

Windows PowerShell 可用：

```powershell
Copy-Item .env.example .env
```

`.env` 内容示例：

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 3) 运行和打包

```bash
npm install
npm run dev
```

打包发布：

```bash
npm run build
```

## 4) GitHub Pages 发布目录
将 `dist` 目录里的内容发布到仓库根目录（或 `docs` 目录）：
- `index.html`
- `assets/*`

## 5) 同步说明
- 首次打开：尝试从 Supabase 读取 `app_state(id='main')`
- 如果云端为空：自动上传当前本地数据作为初始数据
- 后续每次改动：自动 `upsert` 到云端

未配置 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 时，会自动退回本地模式。
