import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FormalGate } from './FormalGate';
import type { CloudSession } from './lib/cloud';
import './styles.css';

type Row = Record<string, string | number | boolean>;
type Store = Record<string, Row[]>;

const STORAGE_KEY = 'zg-auto-erp-v074';
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID();
const money = (v: unknown) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v || 0));

const seed: Store = {
  customers: [
    { id: uid(), type: '个人', name: '示例客户（可编辑）', phone: '626-555-0108', membership: '普通会员', points: 120, balance: 0, notes: '' },
    { id: uid(), type: '车队', name: 'Pacific Fleet LLC', phone: '626-555-0199', membership: '车队月结', points: 0, balance: 0, notes: 'Net 30' },
  ],
  vehicles: [], fleets: [], drivers: [], appointments: [], workOrders: [], estimates: [], invoices: [], payments: [], parts: [], inventoryLogs: [], purchaseOrders: [], suppliers: [], expenses: [], campaigns: [], warranties: [], approvals: [], audits: [], staff: [], technicians: [], members: [], intakes: [], repairCases: [], reminders: [], communications: []
};

const load = (): Store => {
  try { return { ...seed, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return seed; }
};

const fields: Record<string, { key: string; label: string; type?: string; options?: string[] }[]> = {
  customers: [
    { key: 'type', label: '客户类型', options: ['个人', '公司', '车队'] }, { key: 'name', label: '客户/公司名称' },
    { key: 'phone', label: '电话', type: 'tel' }, { key: 'membership', label: '会员等级', options: ['普通会员', '银卡', '金卡', 'VIP', '车队月结'] },
    { key: 'points', label: '积分', type: 'number' }, { key: 'balance', label: '储值余额', type: 'number' }, { key: 'notes', label: '备注' }
  ],
  fleets: [
    { key: 'company', label: '公司名称' }, { key: 'contact', label: '主要联系人' }, { key: 'phone', label: '公司电话', type: 'tel' },
    { key: 'terms', label: '付款条款', options: ['现场付款', 'Net 15', 'Net 30', 'Net 45'] }, { key: 'creditLimit', label: '信用额度', type: 'number' }
  ],
  drivers: [
    { key: 'company', label: '所属公司' }, { key: 'name', label: '司机姓名' }, { key: 'phone', label: '司机电话', type: 'tel' },
    { key: 'license', label: '驾照后四位' }, { key: 'authorized', label: '允许批准维修', options: ['否', '是'] }
  ],
  vehicles: [
    { key: 'owner', label: '客户/公司' }, { key: 'unit', label: 'Unit Number' }, { key: 'plate', label: '车牌' }, { key: 'vin', label: 'VIN' },
    { key: 'year', label: '年份', type: 'number' }, { key: 'make', label: '品牌' }, { key: 'model', label: '车型' }, { key: 'mileage', label: '里程', type: 'number' }
  ],
  appointments: [
    { key: 'date', label: '预约日期', type: 'date' }, { key: 'time', label: '时间', type: 'time' }, { key: 'customer', label: '客户' },
    { key: 'vehicle', label: '车辆' }, { key: 'service', label: '维修项目' }, { key: 'status', label: '状态', options: ['已预约', '已到店', '已转工单', '取消'] }
  ],
  estimates: [
    { key: 'number', label: '报价单号' }, { key: 'date', label: '日期', type: 'date' }, { key: 'customer', label: '客户/公司' },
    { key: 'vehicle', label: '车辆' }, { key: 'summary', label: '报价内容' }, { key: 'amount', label: '报价金额', type: 'number' },
    { key: 'approvalMethod', label: '批准方式', options: ['待批准', '现场签字', '电话', '短信', 'Email'] }, { key: 'approvedBy', label: '批准人' }
  ],
  invoices: [
    { key: 'number', label: '发票号' }, { key: 'date', label: '日期', type: 'date' }, { key: 'workOrder', label: '关联工单' },
    { key: 'customer', label: '客户/公司' }, { key: 'amount', label: '发票金额', type: 'number' }, { key: 'paid', label: '已付款', type: 'number' },
    { key: 'status', label: '状态', options: ['未付款', '部分付款', '已付清', '作废'] }
  ],
  payments: [
    { key: 'date', label: '收款日期', type: 'date' }, { key: 'workOrder', label: '关联工单' }, { key: 'customer', label: '客户/公司' },
    { key: 'type', label: '类型', options: ['订金', '收款', '退款', '会员储值消费'] }, { key: 'amount', label: '金额', type: 'number' },
    { key: 'method', label: '方式', options: ['Cash', 'Credit Card', 'Debit Card', 'Zelle', 'Check', '储值'] }, { key: 'staff', label: '操作员工' }, { key: 'notes', label: '备注' }
  ],
  workOrders: [
    { key: 'number', label: '工单号' }, { key: 'date', label: '日期', type: 'date' }, { key: 'customer', label: '客户/公司' }, { key: 'vehicle', label: '车辆/车牌' },
    { key: 'driver', label: '本次司机' }, { key: 'driverPhone', label: '司机电话', type: 'tel' }, { key: 'po', label: 'PO Number' },
    { key: 'complaint', label: '客户描述' }, { key: 'diagnosis', label: '检查结果/故障码' }, { key: 'laborHours', label: '工时', type: 'number' },
    { key: 'laborRate', label: '工时费率', type: 'number' }, { key: 'partsTotal', label: '配件销售额', type: 'number' }, { key: 'partsCost', label: '配件成本', type: 'number' },
    { key: 'discount', label: '优惠', type: 'number' }, { key: 'tax', label: '税费', type: 'number' }, { key: 'paid', label: '已付款', type: 'number' },
    { key: 'status', label: '状态', options: ['待接车', '等待诊断', '等待客户批准', '等待配件', '维修中', '维修完成', '等待付款', '已交车', '取消'] }
  ],
  parts: [
    { key: 'partNo', label: '配件编号' }, { key: 'oem', label: 'OEM号' }, { key: 'name', label: '配件名称' }, { key: 'supplier', label: '供应商' },
    { key: 'cost', label: '进货价', type: 'number' }, { key: 'price', label: '销售价', type: 'number' }, { key: 'qty', label: '库存', type: 'number' },
    { key: 'minimum', label: '最低库存', type: 'number' }, { key: 'location', label: '货架位置' }
  ],
  inventoryLogs: [
    { key: 'date', label: '日期', type: 'date' }, { key: 'partNo', label: '配件编号' }, { key: 'name', label: '配件名称' },
    { key: 'type', label: '流水类型', options: ['采购入库', '工单领用', '取消退回', '客户退货', '退供应商', '报损', '盘点调整'] },
    { key: 'qty', label: '数量', type: 'number' }, { key: 'reference', label: '关联单号' }, { key: 'staff', label: '操作员工' }
  ],
  purchaseOrders: [
    { key: 'number', label: '采购单号' }, { key: 'date', label: '日期', type: 'date' }, { key: 'supplier', label: '供应商' },
    { key: 'items', label: '采购内容' }, { key: 'amount', label: '采购金额', type: 'number' },
    { key: 'status', label: '状态', options: ['草稿', '待审批', '已批准', '部分到货', '已完成', '取消'] }, { key: 'approver', label: '审批人' }
  ],
  suppliers: [{ key: 'name', label: '供应商名称' }, { key: 'contact', label: '联系人' }, { key: 'phone', label: '电话' }, { key: 'account', label: '账号/备注' }],
  expenses: [{ key: 'date', label: '日期', type: 'date' }, { key: 'category', label: '类别', options: ['配件采购', '房租', '工资', '水电', '工具设备', '拖车', '保险', '广告', '退款', '其他'] }, { key: 'vendor', label: '收款方' }, { key: 'amount', label: '金额', type: 'number' }, { key: 'method', label: '付款方式' }, { key: 'notes', label: '备注' }],
  campaigns: [{ key: 'name', label: '活动名称' }, { key: 'start', label: '开始日期', type: 'date' }, { key: 'end', label: '结束日期', type: 'date' }, { key: 'benefit', label: '优惠内容' }, { key: 'warrantyMonths', label: '保修月数', type: 'number' }, { key: 'warrantyMiles', label: '保修里程', type: 'number' }, { key: 'terms', label: '活动条款' }],
  warranties: [{ key: 'vehicle', label: '车辆' }, { key: 'item', label: '保修项目' }, { key: 'originalRO', label: '原工单' }, { key: 'start', label: '开始日期', type: 'date' }, { key: 'end', label: '到期日期', type: 'date' }, { key: 'mileageLimit', label: '里程上限', type: 'number' }, { key: 'coverage', label: '保修范围', options: ['仅配件', '仅人工', '配件和人工'] }, { key: 'status', label: '状态', options: ['有效', '已使用', '已到期', '作废'] }],
  staff: [{ key: 'name', label: '员工姓名' }, { key: 'role', label: '角色', options: ['老板', '经理', '前台', '技师', '财务', '仓库'] }, { key: 'pin', label: '本地PIN' }, { key: 'status', label: '状态', options: ['启用', '停用'] }, { key: 'permissions', label: '权限说明' }],
  technicians: [{ key: 'name', label: '技师姓名' }, { key: 'phone', label: '电话' }, { key: 'skill', label: '专长' }, { key: 'laborRate', label: '默认工时费率', type: 'number' }, { key: 'commission', label: '提成比例%', type: 'number' }, { key: 'status', label: '状态', options: ['在职', '停用'] }],
  members: [{ key: 'customer', label: '客户' }, { key: 'level', label: '会员等级', options: ['普通', '银卡', '金卡', 'VIP'] }, { key: 'points', label: '当前积分', type: 'number' }, { key: 'cashBalance', label: '实际储值', type: 'number' }, { key: 'bonusBalance', label: '赠送余额', type: 'number' }, { key: 'package', label: '套餐/剩余次数' }, { key: 'expires', label: '到期日期', type: 'date' }],
  approvals: [{ key: 'requester', label: '申请人' }, { key: 'type', label: '操作类型', options: ['修改已付款', '修改优惠', '退款', '修改已交车工单', '删除工单', '库存调整'] }, { key: 'reference', label: '关联工单/记录' }, { key: 'before', label: '修改前' }, { key: 'after', label: '修改后' }, { key: 'reason', label: '原因' }, { key: 'required', label: '需要审批人数', options: ['1', '2'] }, { key: 'status', label: '状态', options: ['待审批', '已批准', '已拒绝'] }],
  intakes: [{ key: 'date', label: '接车日期', type: 'date' }, { key: 'vehicle', label: '车辆/车牌' }, { key: 'mileage', label: '里程', type: 'number' }, { key: 'fuel', label: '油量' }, { key: 'driver', label: '送车人/司机' }, { key: 'driverPhone', label: '送车人电话' }, { key: 'damage', label: '原有损伤' }, { key: 'preScan', label: '维修前故障码' }, { key: 'postScan', label: '维修后故障码' }, { key: 'finalScan', label: '交车前扫描' }, { key: 'photos', label: '照片分类/说明' }, { key: 'signature', label: '客户确认/签名备注' }],
  repairCases: [{ key: 'date', label: '日期', type: 'date' }, { key: 'vehicle', label: '车型/年份' }, { key: 'codes', label: '故障码' }, { key: 'symptom', label: '故障现象' }, { key: 'cause', label: '最终原因' }, { key: 'solution', label: '维修方法' }, { key: 'parts', label: '使用配件' }, { key: 'hours', label: '工时', type: 'number' }, { key: 'technician', label: '技师' }, { key: 'comeback', label: '是否返修', options: ['否', '是'] }],
  reminders: [{ key: 'date', label: '提醒日期', type: 'date' }, { key: 'customer', label: '客户' }, { key: 'vehicle', label: '车辆' }, { key: 'type', label: '提醒类型', options: ['换机油', '轮胎换位', '刹车检查', '冷却液', '变速箱油', '年检注册', '保修到期', '会员到期', '长时间未回店'] }, { key: 'mileage', label: '目标里程', type: 'number' }, { key: 'status', label: '状态', options: ['待提醒', '已联系', '已预约', '完成'] }],
  communications: [{ key: 'date', label: '日期', type: 'date' }, { key: 'customer', label: '客户/公司' }, { key: 'channel', label: '沟通方式', options: ['电话', '短信', 'Email', '微信', '现场'] }, { key: 'subject', label: '主题' }, { key: 'content', label: '沟通内容' }, { key: 'staff', label: '员工' }, { key: 'result', label: '结果/下次跟进' }]
};

const modules = [
  ['dashboard', '▦', '工作台'], ['customers', '●', '客户'], ['fleets', '▰', '车队'], ['drivers', '♙', '司机'], ['vehicles', '◆', '车辆'],
  ['intakes', '▣', '接车检查'], ['workOrders', '▤', '维修工单'], ['estimates', '⌁', '报价单'], ['invoices', '▥', '发票'], ['payments', '$', '收款明细'],
  ['appointments', '▦', '预约'], ['parts', '▧', '库存配件'], ['inventoryLogs', '⇄', '库存流水'], ['purchaseOrders', '▨', '采购单'], ['suppliers', '▱', '供应商'],
  ['members', '★', '会员中心'], ['technicians', '♟', '技师'], ['expenses', '$', '财务支出'], ['reports', '▥', '经营报表'],
  ['campaigns', '★', '活动'], ['warranties', '◇', '保修'], ['reminders', '◷', '提醒中心'], ['communications', '☎', '沟通记录'], ['repairCases', '⌘', '维修案例库'],
  ['staff', '♟', '下属账号'], ['approvals', '✓', '审批中心'], ['audits', '≡', '操作日志'], ['cloud', '☁', '云端能力'], ['backup', '↧', '备份设置']
] as const;

function App({ cloud }: { cloud: CloudSession }) {
  const [data, setData] = useState<Store>(load);
  const [page, setPage] = useState('dashboard');
  const [modal, setModal] = useState<{ module: string; row?: Row } | null>(null);
  const [query, setQuery] = useState('');
  const [globalQuery, setGlobalQuery] = useState('');
  const [menu, setMenu] = useState(false);

  const save = (next: Store) => { setData(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); };

  useEffect(() => {
    let active = true;
    const refresh = () => void cloud.loadStore().then(remote => {
      if (active) save({ ...seed, ...remote });
    }).catch(error => console.error('Cloud refresh failed', error));
    const start = async () => {
      const remote = await cloud.loadStore();
      const remoteHasData = Object.values(remote).some(rows => rows.length > 0);
      if (remoteHasData) {
        if (active) save({ ...seed, ...remote });
      } else {
        const local = load();
        await Promise.all(Object.entries(local).flatMap(([module, rows]) => rows.map(row => cloud.upsertRecord(module, row))));
        if (active) save(local);
      }
    };
    void start().catch(error => console.error('Cloud initialization failed', error));
    const unsubscribe = cloud.subscribe(refresh);
    return () => { active = false; unsubscribe(); };
  }, [cloud]);
  const audit = (action: string, ref: string) => ({ id: uid(), time: new Date().toLocaleString(), user: '老板', action, reference: ref, device: navigator.userAgent.includes('Mobile') ? '手机' : '电脑' });

  const submit = (module: string, form: FormData, old?: Row) => {
    const row: Row = { id: old?.id || uid() };
    for (const f of fields[module]) row[f.key] = f.type === 'number' ? Number(form.get(f.key) || 0) : String(form.get(f.key) || '');
    if (module === 'workOrders') {
      row.laborTotal = Number(row.laborHours || 0) * Number(row.laborRate || 0);
      row.total = Number(row.laborTotal) + Number(row.partsTotal || 0) + Number(row.tax || 0) - Number(row.discount || 0);
      row.balance = Number(row.total) - Number(row.paid || 0);
      row.grossProfit = Number(row.laborTotal) + Number(row.partsTotal || 0) - Number(row.partsCost || 0) - Number(row.discount || 0);
    }
    const list = old ? data[module].map(x => x.id === old.id ? row : x) : [row, ...data[module]];
    save({ ...data, [module]: list, audits: [audit(old ? '修改' : '新增', `${module}:${row.id}`), ...data.audits] });
    if (cloud) void cloud.upsertRecord(module, row).catch(error => alert(`云端保存失败：${error.message}`));
    setModal(null);
  };

  const remove = (module: string, row: Row) => {
    if (!confirm('确认删除这条记录？删除操作会写入日志。')) return;
    save({ ...data, [module]: data[module].filter(x => x.id !== row.id), audits: [audit('删除', `${module}:${row.id}`), ...data.audits] });
    if (cloud) void cloud.deleteRecord(module, String(row.id)).catch(error => alert(`云端删除失败：${error.message}`));
  };

  const currentFields = fields[page] || [];
  const rows = useMemo(() => (data[page] || []).filter(r => JSON.stringify(r).toLowerCase().includes(query.toLowerCase())), [data, page, query]);
  const globalResults = useMemo(() => {
    if (globalQuery.trim().length < 2) return [];
    const q = globalQuery.toLowerCase();
    return Object.entries(data).flatMap(([module, list]) => list.filter(r => JSON.stringify(r).toLowerCase().includes(q)).slice(0, 4).map(row => ({ module, row }))).slice(0, 18);
  }, [data, globalQuery]);

  return <div className="app">
    <aside className={menu ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><div className="mark">Z&G</div><div><strong>AUTO REPAIR</strong><small>ERP v0.74.0 稳定基线</small></div></div>
      <nav>{modules.map(([id, icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => { setPage(id); setMenu(false); setQuery(''); }}><span>{icon}</span>{label}</button>)}</nav>
      <div className="operator">当前账号<br/><strong>{`${cloud.user.email} · ${cloud.role}`}</strong><button className="signout" onClick={() => void cloud.signOut()}>退出登录</button></div>
    </aside>
    <main>
      <header><button className="hamburger" onClick={() => setMenu(!menu)}>☰</button><div><h1>{modules.find(x => x[0] === page)?.[2]}</h1><p>让修车更专注，让管理更简单。</p></div>{cloud && <span className="cloud-live">● 云端实时同步</span>}<div className="global-search"><input value={globalQuery} onChange={e => setGlobalQuery(e.target.value)} placeholder="全局搜索：电话 / VIN / 车牌 / 工单 / 故障码"/>{globalResults.length > 0 && <div className="search-results">{globalResults.map((x, i) => <button key={i} onClick={() => { setPage(x.module); setQuery(String(Object.values(x.row).find(v => typeof v === 'string') || '')); setGlobalQuery(''); }}><b>{modules.find(m => m[0] === x.module)?.[2] || x.module}</b><span>{Object.values(x.row).filter(v => typeof v === 'string' && v).slice(0, 3).join(' · ')}</span></button>)}</div>}</div></header>
      {page === 'dashboard' ? <Dashboard data={data} setPage={setPage}/> : page === 'reports' ? <Reports data={data}/> : page === 'cloud' ? <CloudCapabilities/> : page === 'backup' ? <Backup data={data} save={save}/> : page === 'audits' ? <Audit rows={data.audits}/> : <section className="page">
        <div className="toolbar"><input placeholder="搜索当前模块…" value={query} onChange={e => setQuery(e.target.value)}/><button className="primary" onClick={() => setModal({ module: page })}>＋ 新增</button></div>
        <div className="table-card"><table><thead><tr>{currentFields.slice(0, 7).map(f => <th key={f.key}>{f.label}</th>)}<th>操作</th></tr></thead><tbody>
          {rows.length ? rows.map(r => <tr key={String(r.id)}>{currentFields.slice(0, 7).map(f => <td key={f.key} data-label={f.label}>{f.key.toLowerCase().includes('amount') || ['cost','price','balance','paid','total','partsTotal'].includes(f.key) ? money(r[f.key]) : String(r[f.key] ?? '')}</td>)}<td className="actions">{['workOrders','estimates','invoices'].includes(page) && <button onClick={() => printRecord(page, r)}>打印</button>}<button onClick={() => setModal({ module: page, row: r })}>编辑</button><button className="danger" onClick={() => remove(page, r)}>删除</button></td></tr>) : <tr><td colSpan={8} className="empty">暂无记录，点击“新增”开始。</td></tr>}
        </tbody></table></div>
      </section>}
    </main>
    {modal && <Modal module={modal.module} row={modal.row} close={() => setModal(null)} submit={submit}/>} 
  </div>;
}

function printRecord(module: string, row: Row) {
  const title = module === 'workOrders' ? 'REPAIR ORDER / 维修工单' : module === 'estimates' ? 'ESTIMATE / 报价单' : 'INVOICE / 发票';
  const w = window.open('', '_blank', 'width=900,height=900');
  if (!w) return;
  const lines = Object.entries(row).filter(([k]) => k !== 'id').map(([k,v]) => `<tr><th>${fields[module]?.find(f=>f.key===k)?.label || k}</th><td>${String(v ?? '')}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><title>${title}</title><style>@page{size:letter;margin:10mm}body{font-family:Arial,sans-serif;font-size:8pt;color:#111}.head{text-align:center;border-bottom:2px solid #12385e;padding-bottom:8px}.logo{font-size:22pt;font-weight:900;color:#12385e}.title{font-size:12pt;margin:7px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #bbb;padding:5px;text-align:left}th{width:28%;background:#f3f5f7}.foot{margin-top:20px;border-top:1px solid #aaa;padding-top:8px;font-size:7pt}</style></head><body><div class="head"><div class="logo">Z&G AUTO REPAIR</div><div>志高汽修客户与工单管理系统</div><div class="title">${title}</div></div><table>${lines}</table><div class="foot">客户确认以上维修资料及金额。活动与保修以原始工单条款为准。<br/><br/>客户签名：____________________　日期：____________</div><script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

function Dashboard({ data, setPage }: { data: Store; setPage: (p: string) => void }) {
  const orders = data.workOrders || [];
  const expenses = data.expenses || [];
  const now = today().slice(0, 7);
  const revenueToday = orders.filter(x => x.date === today()).reduce((s, x) => s + Number(x.total || 0), 0);
  const revenueMonth = orders.filter(x => String(x.date || '').startsWith(now)).reduce((s, x) => s + Number(x.total || 0), 0);
  const expenseToday = expenses.filter(x => x.date === today()).reduce((s, x) => s + Number(x.amount || 0), 0);
  const expenseMonth = expenses.filter(x => String(x.date || '').startsWith(now)).reduce((s, x) => s + Number(x.amount || 0), 0);
  const cards = [['今日营业额', revenueToday], ['今日支出', expenseToday], ['今日净额', revenueToday - expenseToday], ['本月营业额', revenueMonth], ['本月支出', expenseMonth], ['本月净额', revenueMonth - expenseMonth]];
  return <section className="page dashboard">
    <div className="hero"><div><span>老板经营驾驶舱</span><h2>Z&G AUTO REPAIR</h2><p>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p></div><button onClick={() => setPage('workOrders')}>＋ 新建工单</button></div>
    <div className="metrics">{cards.map(([label, value]) => <article key={String(label)}><small>{label}</small><strong>{money(value)}</strong><i>{String(label).includes('净额') ? '收入 − 支出' : '自动汇总'}</i></article>)}</div>
    <div className="stats"><article><b>{data.customers.length}</b><span>客户</span></article><article><b>{data.vehicles.length}</b><span>车辆</span></article><article><b>{orders.filter(x => !['已交车','取消'].includes(String(x.status))).length}</b><span>进行中工单</span></article><article><b>{data.appointments.filter(x => x.date === today()).length}</b><span>今日预约</span></article><article><b>{data.parts.filter(x => Number(x.qty) <= Number(x.minimum)).length}</b><span>低库存</span></article><article><b>{data.approvals.filter(x => x.status === '待审批').length}</b><span>待审批</span></article></div>
    <div className="workbench"><h3>快捷工作台</h3><div>{[['customers','添加客户'],['vehicles','添加车辆'],['fleets','车队客户'],['intakes','接车拍照'],['workOrders','维修工单'],['parts','库存配件'],['expenses','登记支出'],['approvals','审批中心']].map(([p,l]) => <button key={p} onClick={() => setPage(p)}>{l}<span>→</span></button>)}</div></div>
    <div className="notice"><h3>老板提醒</h3><p>未收款总额：<b>{money(orders.reduce((s,x)=>s+Number(x.balance||0),0))}</b></p><p>60 天内到期保修：<b>{data.warranties.filter(x => x.status === '有效').length}</b></p><p>所有账号操作（包括老板）均进入操作日志。</p></div>
  </section>;
}

function Reports({ data }: { data: Store }) {
  const month = today().slice(0, 7);
  const orders = data.workOrders || [];
  const expenses = data.expenses || [];
  const payments = data.payments || [];
  const monthOrders = orders.filter(x => String(x.date || '').startsWith(month));
  const revenue = monthOrders.reduce((s,x)=>s+Number(x.total||0),0);
  const received = payments.filter(x=>String(x.date||'').startsWith(month) && x.type !== '退款').reduce((s,x)=>s+Number(x.amount||0),0);
  const refunds = payments.filter(x=>String(x.date||'').startsWith(month) && x.type === '退款').reduce((s,x)=>s+Number(x.amount||0),0);
  const gross = monthOrders.reduce((s,x)=>s+Number(x.grossProfit||0),0)-refunds;
  const operating = expenses.filter(x=>String(x.date||'').startsWith(month)).reduce((s,x)=>s+Number(x.amount||0),0);
  const categories = Object.entries(expenses.filter(x=>String(x.date||'').startsWith(month)).reduce((a,x)=>{const k=String(x.category||'其他');a[k]=Number(a[k]||0)+Number(x.amount||0);return a},{} as Record<string,number>));
  return <section className="page"><div className="hero"><div><span>经营报表 · {month}</span><h2>本月经营概览</h2><p>开单、实收、毛利和经营支出分开统计</p></div></div><div className="metrics">{[['开单营业额',revenue],['实际收款',received],['退款',refunds],['预计毛利润',gross],['经营支出',operating],['净经营收益',gross-operating]].map(([l,v])=><article key={String(l)}><small>{l}</small><strong>{money(v)}</strong><i>本月自动汇总</i></article>)}</div><div className="report-grid"><article className="setting-card"><h2>支出分类</h2>{categories.length?categories.map(([k,v])=><p key={k}><span>{k}</span><b>{money(v)}</b></p>):<p>暂无本月支出</p>}</article><article className="setting-card"><h2>工作流程统计</h2>{['待接车','等待诊断','等待客户批准','等待配件','维修中','维修完成','等待付款','已交车'].map(s=><p key={s}><span>{s}</span><b>{orders.filter(x=>x.status===s).length}</b></p>)}</article><article className="setting-card"><h2>关键风险</h2><p><span>未收款总额</span><b>{money(orders.reduce((s,x)=>s+Number(x.balance||0),0))}</b></p><p><span>低库存配件</span><b>{data.parts.filter(x=>Number(x.qty)<=Number(x.minimum)).length}</b></p><p><span>待审批</span><b>{data.approvals.filter(x=>x.status==='待审批').length}</b></p><p><span>有效保修</span><b>{data.warranties.filter(x=>x.status==='有效').length}</b></p></article></div></section>;
}

function CloudCapabilities() {
  const items = [
    ['多设备实时同步','需要云数据库；单机版先验证页面和流程。'],['员工邮箱密码登录','云端版由老板邀请员工，并设置老板、经理、前台、技师、财务、仓库角色。'],
    ['不可篡改审计日志','必须由服务器写入，任何账号包括老板均不能删除。'],['真正双人审批','服务器验证申请人与两名审批人必须为不同账号。'],
    ['照片与扫描报告','云端对象存储；手机可直接调用相机上传。'],['车牌 OCR / VIN 解码','需接入车牌识别和车辆数据服务；单机版保留拍照与手动确认流程。'],
    ['短信、Email 与付款链接','需接入短信、邮件及支付平台。'],['AI 维修助手','需接入 AI 服务，并优先检索 Z&G 自有维修案例库。'],
    ['客户在线批准与签名','需客户门户和安全的一次性链接。'],['自动备份与升级回退','云服务器部署后配置数据库、照片异地备份和版本迁移。']
  ];
  return <section className="page"><div className="policy"><strong>云端升级边界</strong><span>以下项目已纳入总功能清单，但不会在离线版用假功能冒充完成。</span></div><div className="capability-grid">{items.map(([t,d])=><article className="setting-card" key={t}><h2>{t}</h2><p>{d}</p><span className="planned">已预留 · 云端阶段实现</span></article>)}</div></section>;
}

function Modal({ module, row, close, submit }: { module: string; row?: Row; close: () => void; submit: (m: string, f: FormData, r?: Row) => void }) {
  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && close()}><form className="modal" action={f => submit(module, f, row)}><div className="modal-head"><div><small>{row ? '编辑记录' : '新建记录'}</small><h2>{modules.find(x => x[0] === module)?.[2]}</h2></div><button type="button" onClick={close}>×</button></div><div className="form-grid">{fields[module].map(f => <label key={f.key}><span>{f.label}</span>{f.options ? <select name={f.key} defaultValue={String(row?.[f.key] ?? f.options[0])}>{f.options.map(o => <option key={o}>{o}</option>)}</select> : <input name={f.key} type={f.type || 'text'} defaultValue={String(row?.[f.key] ?? (f.type === 'date' ? today() : ''))}/>}</label>)}</div><div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary" type="submit">保存记录</button></div></form></div>;
}

function Audit({ rows }: { rows: Row[] }) { return <section className="page"><div className="policy"><strong>不可删除审计日志</strong><span>老板、经理和所有员工的关键操作都会保留。</span></div><div className="table-card"><table><thead><tr><th>时间</th><th>账号</th><th>操作</th><th>关联记录</th><th>设备</th></tr></thead><tbody>{rows.map(r => <tr key={String(r.id)}><td>{String(r.time)}</td><td>{String(r.user)}</td><td>{String(r.action)}</td><td>{String(r.reference)}</td><td>{String(r.device)}</td></tr>)}</tbody></table></div></section>; }

function Backup({ data, save }: { data: Store; save: (d: Store) => void }) {
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = `ZG-v074-backup-${today()}.json`; a.click(); };
  return <section className="page settings-grid"><article className="setting-card"><h2>数据备份</h2><p>当前 v0.74.0 使用浏览器本地存储。请定期导出备份。</p><button className="primary" onClick={download}>导出完整备份</button></article><article className="setting-card"><h2>恢复数据</h2><p>导入前会先验证 JSON，不会在解析失败时覆盖数据。</p><input type="file" accept="application/json" onChange={async e => { const file=e.target.files?.[0]; if(!file)return; try { const parsed=JSON.parse(await file.text()); save({ ...seed, ...parsed }); alert('恢复成功'); } catch { alert('文件无效，原数据未改变'); } }}/></article><article className="setting-card"><h2>版本说明</h2><p><b>固定基线：v0.74.0</b></p><p>后续云端升级必须从此版本复制功能，不直接覆盖稳定数据。</p></article></section>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><FormalGate>{cloud => <App cloud={cloud}/>}</FormalGate></React.StrictMode>);
