-- Z&G AUTO ERP v0.75.0 安全升级脚本
-- v0.75.0 的人工、配件、工单、库存和智能工具数据继续存入 zg_erp_records.payload。
-- 因此无需删除或重建任何业务表，原 v0.74.0 数据会保留并在前端自动兼容。

begin;

create index if not exists zg_erp_records_module_record_idx
  on public.zg_erp_records (organization_id, module, record_id);

comment on table public.zg_erp_records is
  'Z&G AUTO ERP v0.75.0 generic versioned business records; nested labor and part line items are stored in payload JSONB.';

comment on column public.zg_erp_records.payload is
  'Business payload. v0.75 supports customers, fleets, drivers, vehicles, workOrders, parts, inventoryLogs, payments, expenses and settings.';

commit;
