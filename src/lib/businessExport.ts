import type { CloudStore } from './cloud';

export function businessExport(data: CloudStore, organizationId: string, userId: string, startedAt: string) {
  return {
    product: 'Z&G AUTO ERP', formatVersion: 1, applicationVersion: '0.96.8',
    exportType: 'authorized-business-records', completeDatabaseBackup: false,
    organizationId, exportedBy: userId, readStartedAt: startedAt, exportedAt: new Date().toISOString(),
    consistency: 'paginated-read-not-transaction-snapshot',
    scope: '当前账号有权读取的业务记录；照片仅含路径或引用，不含照片文件',
    excluded: ['Auth账号及登录信息','员工邀请及权限表','机油活动独立报名/次数/事件表','客户确认独立表','数据库结构与RLS权限策略','Storage照片及附件文件'],
    counts: Object.fromEntries(Object.entries(data).map(([module, rows]) => [module, rows.length])),
    data,
  };
}
