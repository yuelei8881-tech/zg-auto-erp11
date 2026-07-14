# 正式版数据库安装

1. 在 Supabase 新建项目。
2. 打开 SQL Editor。
3. 运行 `migrations/001_v074_formal_core.sql` 的全部内容。
4. 在 Authentication 创建第一个老板账号并确认邮箱。
5. 把 Project URL 和 Publishable Key 配置到部署平台。

首位登录且尚未属于任何组织的用户，会由 `bootstrap_organization()` 创建 Z&G AUTO REPAIR 组织，并获得文本角色 `owner`。`user_id` 始终使用 Supabase Auth UUID，角色永远不会写入 UUID 字段。

业务记录写入 `erp_records`，数据库触发器会把新增、修改和删除写入只读 `audit_logs`。客户端没有修改或删除审计日志的权限。
