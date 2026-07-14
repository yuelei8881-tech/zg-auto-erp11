# Z&G AUTO ERP v0.75.0

这是 Z&G AUTO REPAIR 的云端汽修管理系统升级版，可在电脑、平板和手机浏览器使用。

## 本次核心升级

- 客户、公司车队、司机和车辆完整关联
- VIN 自动识别年份、品牌、车型和发动机
- 明细式维修工单：人工、工时、配件、税费、折扣、付款和欠款自动计算
- 工单保存后自动扣减库存，修改或取消后自动恢复库存
- Estimate、Repair Order、Invoice、Receipt 四种紧凑打印模板
- 今日与本月营业、实收、毛利润、支出、净收益和应收款实时汇总
- OCR 车牌识别和语音生成维修记录
- AI 故障诊断、AI 照片分类、短信通知和在线付款的服务器接口
- 手机、平板和电脑响应式界面

## 云端部署

1. 将项目文件上传到 GitHub 仓库根目录。
2. Vercel 连接该仓库，并设置：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Supabase 首次安装使用 `supabase/migrations/002_v074_isolated_install.sql`；已运行 v0.74.0 的项目只需执行 `supabase/migrations/003_v075_upgrade.sql`。
4. Vercel 自动构建并发布。

## 可选服务

以下功能需要在 Supabase Edge Functions 中配置相应密钥：

- AI 故障诊断、AI 照片分类：`OPENAI_API_KEY`
- 短信通知：Twilio 账号信息
- 在线付款：Stripe Secret Key 与回跳地址

未配置这些服务时，其余客户、车辆、工单、库存、财务、打印、VIN、OCR 和语音功能仍可正常使用。

## 安全提醒

只能把 Supabase Publishable Key 放在 Vercel 前端环境变量中。不要把 Supabase Secret Key、OpenAI Key、Twilio Token 或 Stripe Secret Key 上传到 GitHub。
