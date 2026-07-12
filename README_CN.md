# Z&G AUTO ERP Enterprise v1.0 COMPLETE

完整可部署基础版，包含 17 个业务模块、Supabase 登录、多租户 RLS、角色菜单、经营驾驶舱、CRUD 编辑、电脑/平板/手机响应式。

## 部署
1. Supabase SQL Editor 执行 `supabase/schema.sql`。
2. Supabase Authentication → Users 创建老板账号。
3. GitHub 上传全部文件。
4. Vercel 选择 Vite，添加两个环境变量后 Deploy。

## 环境变量
- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY

注意：前端不能使用 Secret Key / Service Role Key。
