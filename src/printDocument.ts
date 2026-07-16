import { BRAND_LOGO_SVG } from './brandLogo';
import { escapeHtml, money } from './lib/erp';
import type { ShopSettings, WorkOrder } from './types';

const labels: Record<string, string> = {
  Estimate: 'ESTIMATE / 报价单',
  'Repair Order': 'REPAIR ORDER / 维修工单',
  Invoice: 'INVOICE / 发票',
  Receipt: 'RECEIPT / 收据',
};

export function printDocumentV077(order: WorkOrder, settings: ShopSettings, kind: string) {
  const title = labels[kind] || kind;
  const receipt = kind === 'Receipt';
  const showPaymentMethod = (kind === 'Invoice' || receipt) && Boolean(order.paymentMethod);
  const prefix = kind === 'Estimate' ? 'EST' : kind === 'Invoice' ? 'INV' : kind === 'Receipt' ? 'RCPT' : 'RO';
  const numberTail = order.number.replace(/^[A-Z]+-?/i, '');
  const documentNumber = `${prefix}-${numberTail}`;
  const bilingual = (cn?: string, en?: string) => {
    const primary = (cn || '').trim();
    const secondary = (en || '').trim();
    return `<div>${escapeHtml(primary)}</div>${secondary && secondary.toLowerCase() !== primary.toLowerCase() ? `<div class="translation">${escapeHtml(secondary)}</div>` : ''}`;
  };
  const laborRows = (order.laborItems || []).map(item => { const flat = item.billingMode === 'flat'; return `<tr><td>${escapeHtml(item.description)}</td><td class="n">${flat ? 'Flat' : Number(item.hours).toFixed(1)}</td><td class="n">${flat ? '—' : money(item.rate)}</td><td class="n">${money(item.total)}</td></tr>`; }).join('');
  const partRows = (order.partItems || []).map(item => `<tr><td>${escapeHtml(item.partNo)}</td><td>${escapeHtml(item.name)}</td><td class="n">${item.qty}</td><td class="n">${money(item.price)}</td><td class="n">${money(item.total)}</td></tr>`).join('');
  const signed = order.customerSignature
    ? `<div class="signed"><img src="${escapeHtml(order.customerSignature)}"><span>${escapeHtml(order.customerSignedBy || order.customer)}${order.customerSignedAt ? ` · ${escapeHtml(new Date(order.customerSignedAt).toLocaleString())}` : ''}</span></div>`
    : '';
  const now = order.printTime || new Date().toLocaleString('en-US', { hour12: false });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} ${escapeHtml(order.number)}</title><style>
@page{size:Letter;margin:0}*{box-sizing:border-box}body{font-family:Arial,"Microsoft YaHei",sans-serif;font-size:7pt;color:#111;margin:.28in .28in .42in}.print-actions{position:sticky;top:0;z-index:10;display:flex;gap:10px;justify-content:center;padding:10px;background:#eef3fb;border-bottom:1px solid #ccd3df}.print-actions button{font-size:16px;padding:10px 18px;border:1px solid #b9c2d0;border-radius:8px;background:#fff}.print-actions .back{background:#155eef;color:#fff;border-color:#155eef}.top{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:start;font-size:7pt}.top .t{text-align:center;font-size:10pt}.top .ro{text-align:right;color:#d60000;font-size:14pt;font-weight:800}.brand{display:grid;grid-template-columns:220px 1fr;align-items:center;border-bottom:2px solid #111;padding:7px 0 8px}.brand svg{width:205px;height:81px;margin:0}.shop{text-align:center}.shop h1{font-size:22pt;letter-spacing:2px;margin:0 0 5px}.shop p{font-size:8pt;margin:0}.info{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:10px}.box{border:1px solid #777;min-height:58px;padding:5px;line-height:1.35}.box b{display:inline-block;width:57px}.section{margin-top:7px}.section-title{font-size:7pt;color:#666;margin:0 0 3px 3px}.text-box{border:1px solid #888;min-height:34px;padding:5px;white-space:pre-wrap}.translation{margin-top:3px;color:#333;font-style:italic;border-top:1px dotted #bbb;padding-top:2px}.work-time{font-size:6pt;color:#555;margin-top:3px}.line-title{font-weight:700;margin:6px 0 2px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:2.5px 4px;vertical-align:top}th{font-weight:700;text-align:left;background:#f5f5f5}.n{text-align:right}.totals{width:46%;margin:7px 0 0 auto}.totals td:first-child{text-align:right}.total td{border-top:2px solid #111;font-size:9pt;font-weight:800}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:34px;margin-top:25px}.sig{border-top:1px solid #111;padding-top:3px;min-height:25px}.signed img{display:block;max-width:210px;max-height:52px;object-fit:contain}.signed span{font-size:6pt}.footer{text-align:center;margin-top:8px;color:#555;font-size:6pt}.document-footer{position:fixed;left:.28in;right:.28in;bottom:.15in;display:flex;justify-content:space-between;border-top:1px solid #bbb;padding-top:4px;color:#555;font-size:6.5pt}@media screen{.document-footer{display:none}}@media print{.print-actions{display:none}}
</style></head><body>
<div class="print-actions"><button class="back" type="button" onclick="returnToOrder()">← 返回工单</button><button type="button" onclick="window.print()">再次打印</button></div>
<div class="top"><div>${escapeHtml(now)}</div><div class="t">${escapeHtml(title)}</div><div class="ro">${escapeHtml(documentNumber)}</div></div>
<div class="brand"><div>${BRAND_LOGO_SVG}</div><div class="shop"><h1>Z&amp;G AUTO REPAIR</h1><p>${escapeHtml(settings.address || '319 Agostino Rd, San Gabriel, CA 91776')} · Tel / 电话 ${escapeHtml(settings.phone || '626-508-0888')}</p></div></div>
<div class="info"><div class="box"><b>Customer</b>${escapeHtml(order.customer)}<br><b>Phone</b>${escapeHtml(order.phone)}<br><b>Company</b>${escapeHtml(order.company || '')}<br><b>Driver</b>${escapeHtml(order.driver || '')} ${escapeHtml(order.driverPhone || '')}</div><div class="box"><b>Vehicle</b>${escapeHtml(order.vehicle)}<br><b>Plate</b>${escapeHtml(order.plate)}<br><b>VIN</b>${escapeHtml(order.vin)}<br><b>Mileage</b>${escapeHtml(order.mileage)} &nbsp;&nbsp; <b>PO</b>${escapeHtml(order.po || '')}</div></div>
<div class="section"><div class="section-title">Customer Concern / 客户描述</div><div class="text-box">${bilingual(order.complaint, order.complaintEn)}</div></div>
<div class="section"><div class="section-title">Diagnosis / 检查与诊断</div><div class="text-box">${bilingual(order.diagnosis, order.diagnosisEn)}</div></div>
<div class="section"><div class="section-title">Work Performed / 完成的维修</div><div class="text-box">${bilingual(order.workPerformed, order.workPerformedEn)}</div>${order.workTimeNote ? `<div class="work-time">Work time / 做工时间：${escapeHtml(order.workTimeNote)}</div>` : ''}</div>
${laborRows ? `<div class="section"><div class="line-title">Labor / 人工</div><table><thead><tr><th>Description / 项目</th><th class="n">Hours</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>${laborRows}</tbody></table></div>` : ''}
${partRows ? `<div class="section"><div class="line-title">Parts / 配件</div><table><thead><tr><th>Part #</th><th>Description / 名称</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${partRows}</tbody></table></div>` : ''}
<table class="totals"><tr><td>Labor</td><td class="n">${money(order.laborTotal)}</td></tr><tr><td>Parts</td><td class="n">${money(order.partsTotal)}</td></tr><tr><td>Outsource</td><td class="n">${money(order.outsource)}</td></tr><tr><td>Parts Sales Tax / 配件销售税</td><td class="n">${money(order.tax)}</td></tr><tr><td>Discount</td><td class="n">-${money(order.discount)}</td></tr><tr class="total"><td>${receipt ? 'Amount Paid' : 'Total'}</td><td class="n">${money(receipt ? order.paid : order.total)}</td></tr>${receipt ? '' : `<tr><td>Paid</td><td class="n">${money(order.paid)}</td></tr><tr><td>Balance Due</td><td class="n">${money(order.balance)}</td></tr>`}${showPaymentMethod ? `<tr><td>Payment Method / 支付方式</td><td class="n">${escapeHtml(order.paymentMethod || 'Not recorded / 未记录')}</td></tr>` : ''}</table>
<div class="signatures"><div class="sig">${signed}<b>Customer Signature / Date · 客户签字/日期</b></div><div class="sig"><b>Authorized By / Date · 授权人/日期</b></div></div><div class="footer">${escapeHtml(settings.invoiceTerms || 'Thank you for your business.')}</div><div class="document-footer"><span>https://zgautorepair.com</span><span>Page 1 of 1</span></div>
<script>function returnToOrder(){if(window.opener&&!window.opener.closed){window.close();return}if(history.length>1){history.back();return}location.replace('/')}window.onload=()=>window.print()</script></body></html>`;
  const win = window.open('', '_blank');
  if (!win) return alert('浏览器阻止了打印窗口，请允许弹出窗口后重试。');
  win.document.write(html);
  win.document.close();
}
