import { BRAND_LOGO_SVG } from './brandLogo';
import { escapeHtml, money } from './lib/erp';
import type { ShopSettings, WorkOrder } from './types';

type RepairHistorySubject = { title: string; subtitle: string; contact?: string };

export function printRepairHistory(subject: RepairHistorySubject, orders: WorkOrder[], settings: ShopSettings) {
  const sorted = [...orders].sort((a, b) => `${b.date}${b.number}`.localeCompare(`${a.date}${a.number}`));
  const total = sorted.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const rows = sorted.map(order => {
    const workCn = order.workPerformed || order.diagnosis || order.complaint || '—';
    const workEn = order.workPerformedEn || order.diagnosisEn || order.complaintEn || '';
    const partsCn = (order.partItems || []).filter(item => item.name).map(item => `${item.name} ×${item.qty}`).join('、');
    const partsEn = (order.partItems || []).filter(item => item.nameEn).map(item => `${item.nameEn} ×${item.qty}`).join(', ');
    return `<tr><td>${escapeHtml(order.date)}<br><b>${escapeHtml(order.number)}</b></td><td>${escapeHtml(order.vehicle || '—')}<br><span>${escapeHtml(order.plate || '—')} · VIN ${escapeHtml(order.vin || '—')}</span></td><td>${escapeHtml(order.mileage || '—')}</td><td>${escapeHtml(workCn)}${workEn && workEn.toLowerCase() !== workCn.toLowerCase() ? `<br><em>${escapeHtml(workEn)}</em>` : ''}${partsCn ? `<br><span>配件：${escapeHtml(partsCn)}</span>` : ''}${partsEn && partsEn.toLowerCase() !== partsCn.toLowerCase() ? `<br><span>Parts: ${escapeHtml(partsEn)}</span>` : ''}</td><td>${escapeHtml(order.status || '—')}</td><td class="amount">${money(order.total)}</td></tr>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject.title)}</title><style>
@page{size:Letter;margin:.45in}*{box-sizing:border-box}body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#111;margin:0;font-size:10px}.actions{display:flex;justify-content:center;gap:10px;padding:12px;background:#eef3fb}.actions button{font-size:15px;padding:9px 18px;border:1px solid #b9c2d0;border-radius:8px;background:#fff}.actions .primary{background:#155eef;color:#fff}.brand{display:grid;grid-template-columns:170px 1fr;align-items:center;border-bottom:2px solid #111;padding:10px 0}.brand svg{width:155px;height:auto}.shop{text-align:right}.shop h1{font-size:22px;letter-spacing:2px;margin:0 0 5px}.shop p{margin:0}.heading{margin:18px 0 12px}.heading h2{font-size:19px;margin:0 0 5px}.heading p{margin:3px 0;color:#555}.summary{display:flex;gap:24px;padding:9px 12px;background:#f3f6fb;border:1px solid #ccd3df;margin-bottom:12px}.summary b{font-size:14px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:6px;vertical-align:top}th{background:#eef2f7;text-align:left}.amount{text-align:right;white-space:nowrap}td span{color:#555;font-size:9px}.empty{text-align:center;padding:28px;color:#777}.footer{margin-top:16px;border-top:1px solid #bbb;padding-top:6px;display:flex;justify-content:space-between;color:#666}@media print{.actions{display:none}}
</style></head><body><div class="actions"><button class="primary" onclick="window.print()">打印维修档案</button><button onclick="window.close()">关闭</button></div><div class="brand"><div>${BRAND_LOGO_SVG}</div><div class="shop"><h1>Z&amp;G AUTO REPAIR</h1><p>${escapeHtml(settings.address || '319 Agostino Rd, San Gabriel, CA 91776')}</p><p>${escapeHtml(settings.phone || '626-508-0888')} · zgautorepair.com</p></div></div><div class="heading"><h2>${escapeHtml(subject.title)}</h2><p>${escapeHtml(subject.subtitle)}</p>${subject.contact ? `<p>${escapeHtml(subject.contact)}</p>` : ''}</div><div class="summary"><span>维修记录 / Visits：<b>${sorted.length}</b></span><span>累计金额 / Total：<b>${money(total)}</b></span></div><table><thead><tr><th>Date / 工单</th><th>Vehicle / 车辆</th><th>Mileage</th><th>Repair Details / 维修内容</th><th>Status</th><th>Amount</th></tr></thead><tbody>${rows || '<tr><td class="empty" colspan="6">No repair history / 暂无维修记录</td></tr>'}</tbody></table><div class="footer"><span>Generated ${escapeHtml(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))}</span><span>zgautorepair.com</span></div></body></html>`;
  const win = window.open('', '_blank');
  if (!win) return alert('浏览器阻止了打印窗口，请允许弹出窗口后重试。');
  win.document.write(html);
  win.document.close();
}
