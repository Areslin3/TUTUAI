# 兔兔及时达自动化部署进度查询系统

## 数据模式

- 本地模式：数据保存在浏览器 `localStorage`。
- 云端同步模式：使用 Supabase 的 `public.app_state` 单行 JSON 数据，多人共享同一份任务、留言、附件元数据和回收站状态。

前端可以使用 `.env` 覆盖 Supabase 项目配置；如果不创建 `.env`，会使用 `src/cloudSync.js` 内置的默认 Supabase 配置。

## Supabase 初始化

在 Supabase SQL Editor 执行完整脚本：

```sql
supabase/setup-app_state.sql
```

脚本会创建或更新：

- `public.app_state` 表
- `state` 必须是 JSON object 的约束
- 自动维护 `updated_at` 的触发器
- 只允许 anon 角色读写 `id = 'main'` 的 RLS 策略
- Realtime publication

更新数据库规则后，可以安全重复执行该脚本。

## 环境变量

复制 `.env.example` 为 `.env` 并替换自己的 Supabase 项目信息：

```powershell
Copy-Item .env.example .env
```

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

本地预览：

```bash
npm run preview
```

## 安全提醒

当前项目是内部协作工具：前端登录、用户列表和任务状态都保存在同一份 `app_state` JSON 中。Supabase anon key 可以公开，但真正的权限边界只靠 RLS 限制到单行数据。若要开放给不可信用户或公网长期使用，建议升级为 Supabase Auth、服务端 API、按用户鉴权和独立附件存储桶策略。
