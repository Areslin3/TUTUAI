# 兔兔及时达自动化部署进度查询系统

## 数据模式

- 本地模式：数据保存在浏览器 `localStorage`。
- 云端同步模式：通过 Netlify Functions + Blobs 存储整站 JSON 状态（任务、留言、附件元数据、回收站），国内网络可正常访问，不依赖 `*.supabase.co`。

云端 API 默认地址：`https://beautiful-basbousa-c7556d.netlify.app/.netlify/functions/app-state`

可通过 `.env` 覆盖：

```env
VITE_CLOUD_API_URL=https://your-site.netlify.app/.netlify/functions/app-state
```

## 历史 Supabase 配置（已弃用）

旧版使用 Supabase `app_state` 表；若你仍在使用旧部署且 Supabase 可访问，可参考 `supabase/setup-app_state.sql`。当前生产环境已切换为 Netlify Blobs。

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

当前项目是内部协作工具：登录账号、任务与附件元数据保存在同一份云端 JSON 中，Netlify 函数接口目前未做鉴权。仅建议在可信团队内网使用；若要对公网开放，需增加访问令牌、按用户鉴权，并将大附件迁到对象存储。
