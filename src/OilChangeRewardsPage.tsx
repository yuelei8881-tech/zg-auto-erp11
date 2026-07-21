import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { supabase } from './lib/supabase';
import './oilChangeRewards.css';

type Lang = 'zh' | 'en';
type VehicleForm = { vin: string; plate: string; state: string; year: string; make: string; model: string; engine: string; unit: string; driverName: string; driverPhone: string };
type RewardProgress = {
  status: string;
  contactName: string;
  vehicles: Array<{ id: string; vinLast6?: string; plate?: string; year?: number; make?: string; model?: string; count?: number; rewardEarnedAt?: string; rewardExpiresAt?: string; rewardRedeemedAt?: string; status?: string }>;
};
const blankVehicle = (): VehicleForm => ({ vin: '', plate: '', state: 'CA', year: '', make: '', model: '', engine: '', unit: '', driverName: '', driverPhone: '' });
const termsVersion = '2026-07-20-v1';

const copy = {
  zh: {
    eyebrow: 'Z&G 机油保养奖励计划', title: '换 5 次机油，第 6 次免费', subtitle: '每辆车单独累计。在线登记后，符合条件的保养会自动计入车辆进度。',
    personal: '个人客户', fleet: '公司 / 车队', contact: '联系人姓名', phone: '手机号码', email: '电子邮箱', company: '公司名称', tcp: 'TCP 号码', optional: '选填',
    vehicles: '参加活动的车辆', addVehicle: '添加另一辆车', remove: '删除', vin: 'VIN 车架号', plate: '车牌号码', state: '州', year: '年份', make: '品牌', model: '车型', engine: '发动机（选填）', unit: '车队编号（选填）', driver: '实际司机（选填）', driverPhone: '司机电话（选填）', vehicleNotice: '此处为客户预登记资料。车辆到店后，以本店扫描 VIN、识别车牌并由员工核对录入的正式车辆资料为准。',
    termsTitle: '活动规则与免责声明', agree: '我已阅读并同意中英文活动条款；如两种语言有冲突，以英文版本为准。', sms: '我同意接收本活动进度、奖励和维修相关短信。此项为选填；同意短信不是购买服务或参加活动的条件。可回复 STOP 退订。',
    submit: '登记参加活动', submitting: '正在安全提交…', success: '登记已收到', successText: '我们会核对客户与车辆资料。通过后，登记日期之后的合格机油保养将按车辆分别累计。', saveLink: '请保存您的专属进度查询链接', copyLink: '复制链接', copied: '已复制', error: '提交失败，请检查资料后重试。',
  },
  en: {
    eyebrow: 'Z&G Oil Change Rewards', title: 'Buy 5 oil changes. Get the 6th free.', subtitle: 'Progress is tracked separately for each registered vehicle after enrollment.',
    personal: 'Individual', fleet: 'Business / Fleet', contact: 'Contact name', phone: 'Mobile number', email: 'Email address', company: 'Legal business name', tcp: 'TCP number', optional: 'Optional',
    vehicles: 'Participating vehicles', addVehicle: 'Add another vehicle', remove: 'Remove', vin: 'VIN', plate: 'License plate', state: 'State', year: 'Year', make: 'Make', model: 'Model', engine: 'Engine (optional)', unit: 'Fleet unit (optional)', driver: 'Driver name (optional)', driverPhone: 'Driver phone (optional)', vehicleNotice: 'Customer-entered information is preliminary. After arrival, the shop’s VIN scan, plate recognition, and staff-verified vehicle record will control.',
    termsTitle: 'Program Terms & Disclosures', agree: 'I have read and agree to the bilingual program terms. If the two versions conflict, the English version controls.', sms: 'I agree to receive transactional program progress, reward, and repair-related text messages. Optional; SMS consent is not a condition of purchase or participation. Reply STOP to opt out.',
    submit: 'Enroll in rewards', submitting: 'Submitting securely…', success: 'Enrollment received', successText: 'We will review and match your customer and vehicle records. Qualifying oil changes after enrollment will then be tracked separately for each vehicle.', saveLink: 'Save your private progress link', copyLink: 'Copy link', copied: 'Copied', error: 'Submission failed. Please review the information and try again.',
  },
};

function ProgramTerms() {
  return <div className="reward-terms-copy">
    <section lang="zh"><h3>中文活动条款</h3><ol>
      <li>客户成功登记后，每辆登记车辆完成五次符合条件的付费机油保养，可获得同一车辆第六次机油保养免费；不同车辆的次数不得合并或转让。</li>
      <li>免费保养包含依车辆制造商规格及实际车型所需数量的本店常规全合成机油、适用的本店常用滤芯、标准人工、税费及环保费。机油粘度、认证标准、数量及滤芯适用性以 VIN、发动机和制造商要求为准。</li>
      <li>特殊滤芯、柴油车及欧洲车型在本活动内不另收补差价，但服务须属于本店可正常、安全提供的范围；超出常规机油保养的维修、零件或服务不包含在免费项目内。</li>
      <li>客户填写的车辆信息属于预登记资料。车辆到店后，以本店通过 VIN 扫描、车牌识别及员工核对后录入 ERP 的正式车辆资料为准。</li><li>只有成功登记后，在 Z&G Auto Body And Repair 完成并结清的正式工单才计数。经批准的月结车队工单在完工并记入月结账户后计数。取消、退款、冲销、重复或欺诈交易不计数，并可被撤销。</li>
      <li>奖励在第五次合格服务完成时取得，自取得日起十二个月内有效；不可兑换现金、出售、转让或与其他车辆进度合并。</li>
      <li>Z&G 可为防止欺诈、纠正错误或符合法律而审核、暂停或更正记录，并可在合理通知后对未来交易修改或终止活动，但不会无理取消已经取得且尚未过期的奖励。</li>
      <li>短信同意为选填，不是购买服务或参加本活动的条件。客户资料依本店隐私政策处理。</li>
    </ol><p><b>重要：</b>本中文版本仅为便利翻译。如与英文版本存在差异，以英文版本为准，但不限制适用法律下不可放弃的消费者权利。</p></section>
    <section lang="en"><h3>English Program Terms (Controlling Version)</h3><ol>
      <li>After successful enrollment, each registered vehicle earns one complimentary sixth oil change after five qualifying paid oil changes. Progress is vehicle-specific and may not be combined or transferred.</li>
      <li>The complimentary service includes the quantity of the shop's regular full-synthetic motor oil required by the vehicle manufacturer, an applicable commonly stocked oil filter, standard labor, taxes, and environmental fees. Oil viscosity, approvals, quantity, and filter fitment are determined from the VIN, engine, and manufacturer requirements.</li>
      <li>No surcharge is added solely because a vehicle uses a specialty filter, is diesel-powered, or is a European model, provided the service can be performed safely within the shop's normal capabilities. Repairs, parts, and services beyond a standard oil change are excluded.</li>
      <li>Vehicle information entered by a customer is preliminary. After arrival, the official ERP vehicle record verified by the shop through VIN scanning, plate recognition, and staff review controls.</li><li>Only qualifying repair orders completed after successful enrollment and fully settled count. Approved monthly-account fleet work counts when completed and posted to the monthly account. Canceled, refunded, reversed, duplicate, or fraudulent transactions do not count and may be removed.</li>
      <li>A reward is earned when the fifth qualifying service is completed and expires 12 months later. Rewards have no cash value and may not be sold, transferred, or combined with another vehicle.</li>
      <li>Z&G may review, suspend, or correct records to prevent fraud, correct errors, or comply with law. Z&G may prospectively modify or end the program after reasonable notice, but will not unreasonably revoke an earned, unexpired reward.</li>
      <li>SMS consent is optional and is not a condition of purchase or participation. Personal information is handled under the shop's Privacy Policy.</li>
    </ol><p><b>Disclaimer:</b> Vehicle eligibility and safe service requirements are determined at inspection. Nothing in these terms waives rights that cannot be waived under applicable law. The English version controls in the event of a translation inconsistency.</p></section>
  </div>;
}

function CurrentOffers() {
  return <section className="reward-offers"><p className="reward-progress-eyebrow">CURRENT OFFERS / 当前优惠</p><h2>More ways to care for your vehicle / 更多车辆服务</h2><div className="reward-offer-grid"><article><b>Complimentary Tire Check</b><h3>免费轮胎检查</h3><p>Tire pressure, tread, and visible wear check with scheduled service.<br />预约维修时可检查胎压、胎纹及可见磨损。</p></article><article><b>Brake Safety Check</b><h3>刹车安全检查</h3><p>Ask for a visual brake inspection with qualifying service.<br />符合条件的到店服务可申请刹车系统目视检查。</p></article><article><b>Fleet Maintenance Support</b><h3>车队保养支持</h3><p>Vehicle-by-vehicle records and maintenance planning for fleets.<br />为车队提供逐车档案与保养计划。</p></article></div><p className="reward-offer-note">Offers are subject to availability and inspection; additional repairs or parts require approval. / 优惠视预约和车辆检查情况而定，额外维修或配件须经客户批准。</p><a className="reward-contact-offer" href="tel:+16265080888">Call / 致电 626-508-0888</a></section>;
}

function RecoverRewardLink() {
  const [phone, setPhone] = useState(''); const [vin6, setVin6] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [link, setLink] = useState('');
  const recover = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setMessage(''); setLink(''); try {
    if (!supabase) throw new Error('Service unavailable');
    const { data, error } = await supabase.rpc('zg_recover_oil_reward_registration', { p_phone: phone, p_vin_last6: vin6 });
    if (error) throw error; const token = (data as { token?: string })?.token; if (!token) throw new Error('No matching enrollment found');
    setLink(`${window.location.origin}${window.location.pathname}?reward_token=${encodeURIComponent(token)}`);
  } catch { setMessage('No matching enrollment found. Please verify the phone number and VIN last 6. / 未找到匹配记录，请核对手机号码和 VIN 后六位。'); } finally { setBusy(false); } };
  return <section className="reward-recover"><p className="reward-progress-eyebrow">PRIVATE LINK RECOVERY / 找回专属链接</p><h2>No password required / 无需注册密码</h2><p>Verify the mobile number and the last six characters of one enrolled VIN.<br />请输入登记手机号码和其中一辆车 VIN 的后六位进行验证。</p><form onSubmit={recover}><label>Mobile / 手机号码<input required type="tel" value={phone} onChange={event => setPhone(event.target.value)} /></label><label>VIN last 6 / VIN 后六位<input required minLength={6} maxLength={6} value={vin6} onChange={event => setVin6(event.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,''))} /></label><button disabled={busy}>{busy ? 'Verifying… / 正在验证…' : 'Recover Link / 找回链接'}</button></form>{message && <p className="reward-error">{message}</p>}{link && <div className="reward-recovered"><b>Private progress link / 专属进度链接</b><code>{link}</code><a href={link}>Open Progress / 打开进度</a></div>}</section>;
}

export function OilChangeRewardsPage({ Header, Footer }: { Header: ComponentType; Footer: ComponentType }) {
  const [lang, setLang] = useState<Lang>('zh'); const t = copy[lang];
  const [accountType, setAccountType] = useState<'personal' | 'fleet'>('personal');
  const [form, setForm] = useState({ contactName: '', phone: '', email: '', companyName: '', tcpNumber: '', termsAccepted: false, smsConsent: false });
  const [vehicles, setVehicles] = useState<VehicleForm[]>([blankVehicle()]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState<{ enrollmentId: string; token: string } | null>(null); const [copied, setCopied] = useState(false);
  const rewardToken = useMemo(() => new URLSearchParams(window.location.search).get('reward_token')?.trim() || '', []);
  const [progress, setProgress] = useState<RewardProgress | null>(null);
  const [progressBusy, setProgressBusy] = useState(Boolean(rewardToken));
  const [progressError, setProgressError] = useState('');
  const progressUrl = useMemo(() => result ? `${window.location.origin}${window.location.pathname}?reward_token=${encodeURIComponent(result.token)}` : '', [result]);
  useEffect(() => {
    if (!rewardToken) return;
    let active = true;
    (async () => {
      try {
        if (!supabase) throw new Error('Service unavailable');
        const { data, error: rpcError } = await supabase.rpc('zg_get_oil_reward_registration', { p_token: rewardToken });
        if (rpcError) throw rpcError;
        if (active) setProgress(data as RewardProgress);
      } catch (cause) {
        if (active) setProgressError(cause instanceof Error ? cause.message : 'Unable to load reward progress');
      } finally {
        if (active) setProgressBusy(false);
      }
    })();
    return () => { active = false; };
  }, [rewardToken]);
  const updateVehicle = (index: number, field: keyof VehicleForm, value: string) => setVehicles(items => items.map((item, i) => i === index ? { ...item, [field]: value } : item));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (!supabase) throw new Error('Service unavailable');
      const { data, error: rpcError } = await supabase.rpc('zg_submit_oil_reward_registration', { p_payload: { accountType, ...form, preferredLanguage: lang, termsVersion, vehicles } });
      if (rpcError) throw rpcError;
      const payload = data as { enrollmentId?: string; token?: string };
      if (!payload?.enrollmentId || !payload?.token) throw new Error('Invalid server response');
      setResult({ enrollmentId: payload.enrollmentId, token: payload.token });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.error); } finally { setBusy(false); }
  };
  if (rewardToken) return <><Header /><main className="reward-page"><section className="reward-progress">
    <p className="reward-progress-eyebrow">Z&amp;G OIL CHANGE REWARDS / 换机油奖励</p>
    <h1>Reward Progress / 活动进度</h1>
    {progressBusy && <p className="reward-progress-message">Loading progress… / 正在查询进度…</p>}
    {!progressBusy && progressError && <><div className="reward-error"><b>Unable to open this progress link.</b><br />无法打开此进度链接，请确认链接完整或联系 626-508-0888。</div><RecoverRewardLink /></>}
    {!progressBusy && progress && <>
      <div className="reward-progress-summary"><div><span>Customer / 客户</span><b>{progress.contactName || '—'}</b></div><div><span>Enrollment / 登记状态</span><b>{progress.status === 'approved' ? 'Approved / 已通过' : progress.status === 'rejected' ? 'Needs review / 需处理' : 'Pending review / 等待审核'}</b></div></div>
      <p className="reward-progress-note">Each vehicle is tracked separately. Shop-verified VIN and plate records control.<br />每辆车分别累计，以到店后由本店核验的 VIN 和车牌资料为准。</p>
      <div className="reward-progress-vehicles">{(progress.vehicles || []).map((vehicle, index) => {
        const count = Math.max(0, Math.min(5, Number(vehicle.count || 0)));
        const rewarded = Boolean(vehicle.rewardEarnedAt) && !vehicle.rewardRedeemedAt;
        return <article key={vehicle.id || index}><div className="reward-progress-vehicle-head"><div><small>Vehicle {index + 1} / 车辆 {index + 1}</small><h2>{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Registered vehicle / 已登记车辆'}</h2><p>{vehicle.plate ? `Plate / 车牌: ${vehicle.plate}` : ''}{vehicle.vinLast6 ? ` · VIN ••••••${vehicle.vinLast6}` : ''}</p></div><strong>{rewarded ? 'FREE SERVICE READY / 免费保养可用' : `${count} / 5`}</strong></div><div className="reward-progress-dots">{[1,2,3,4,5].map(step => <i key={step} className={step <= count ? 'done' : ''}>{step}</i>)}<i className={rewarded ? 'reward-ready' : ''}>6<br /><small>FREE</small></i></div>{vehicle.rewardExpiresAt && rewarded && <p className="reward-expiry">Expires / 到期：{new Date(vehicle.rewardExpiresAt).toLocaleDateString()}</p>}{vehicle.rewardRedeemedAt && <p className="reward-redeemed">Redeemed / 已使用：{new Date(vehicle.rewardRedeemedAt).toLocaleDateString()}</p>}</article>;
      })}</div>
    </>}
  </section><CurrentOffers /></main><Footer /></>;
  return <><Header /><main className="reward-page">
    <section className="reward-hero"><div className="reward-lang"><button className={lang === 'zh' ? 'active' : ''} onClick={() => setLang('zh')}>中文</button><button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button></div><p>{t.eyebrow}</p><h1>{t.title}</h1><span>{t.subtitle}</span><div className="reward-count"><b>1</b><i>2</i><i>3</i><i>4</i><i>5</i><strong>FREE<br />免费</strong></div></section>
    {result ? <section className="reward-success"><div>✓</div><h2>{t.success}</h2><p>{t.successText}</p><b>{t.saveLink}</b><code>{progressUrl}</code><button onClick={async () => { await navigator.clipboard.writeText(progressUrl); setCopied(true); }}>{copied ? t.copied : t.copyLink}</button></section> :
    <form className="reward-form" onSubmit={submit}>
      <div className="reward-type"><button type="button" className={accountType === 'personal' ? 'active' : ''} onClick={() => setAccountType('personal')}>{t.personal}</button><button type="button" className={accountType === 'fleet' ? 'active' : ''} onClick={() => setAccountType('fleet')}>{t.fleet}</button></div>
      <section><h2>1. {accountType === 'fleet' ? t.fleet : t.personal}</h2><div className="reward-grid"><label>{t.contact}<input required value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} /></label><label>{t.phone}<input required type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label><label>{t.email}<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>{accountType === 'fleet' && <label>{t.company}<input required value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} /></label>}<label>{t.tcp} ({accountType === 'personal' ? t.optional : ''})<input required={accountType === 'fleet'} value={form.tcpNumber} onChange={e => setForm({ ...form, tcpNumber: e.target.value })} /></label></div></section>
      <section><h2>2. {t.vehicles}</h2>{vehicles.map((vehicle, index) => <div className="reward-vehicle" key={index}><div className="reward-vehicle-title"><b>Vehicle {index + 1} / 车辆 {index + 1}</b>{vehicles.length > 1 && <button type="button" onClick={() => setVehicles(items => items.filter((_, i) => i !== index))}>{t.remove}</button>}</div><div className="reward-grid"><label>{t.vin}<input required minLength={11} maxLength={17} value={vehicle.vin} onChange={e => updateVehicle(index, 'vin', e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, ''))} /></label><label>{t.plate}<input required value={vehicle.plate} onChange={e => updateVehicle(index, 'plate', e.target.value.toUpperCase())} /></label><label>{t.state}<input required value={vehicle.state} onChange={e => updateVehicle(index, 'state', e.target.value.toUpperCase())} /></label><label>{t.year}<input required inputMode="numeric" value={vehicle.year} onChange={e => updateVehicle(index, 'year', e.target.value)} /></label><label>{t.make}<input required value={vehicle.make} onChange={e => updateVehicle(index, 'make', e.target.value)} /></label><label>{t.model}<input required value={vehicle.model} onChange={e => updateVehicle(index, 'model', e.target.value)} /></label><label>{t.engine}<input value={vehicle.engine} onChange={e => updateVehicle(index, 'engine', e.target.value)} /></label>{accountType === 'fleet' && <><label>{t.unit}<input value={vehicle.unit} onChange={e => updateVehicle(index, 'unit', e.target.value)} /></label><label>{t.driver}<input value={vehicle.driverName} onChange={e => updateVehicle(index, 'driverName', e.target.value)} /></label><label>{t.driverPhone}<input type="tel" value={vehicle.driverPhone} onChange={e => updateVehicle(index, 'driverPhone', e.target.value)} /></label></>}</div></div>)}<button className="reward-add" type="button" onClick={() => setVehicles(items => [...items, blankVehicle()])}>+ {t.addVehicle}</button></section>
      <section><details className="reward-terms"><summary>{t.termsTitle} / Program Terms</summary><ProgramTerms /></details><label className="reward-check"><input required type="checkbox" checked={form.termsAccepted} onChange={e => setForm({ ...form, termsAccepted: e.target.checked })} /><span>{t.agree}</span></label><label className="reward-check"><input type="checkbox" checked={form.smsConsent} onChange={e => setForm({ ...form, smsConsent: e.target.checked })} /><span>{t.sms}</span></label></section>
      {error && <p className="reward-error">{error}</p>}<button className="reward-submit" disabled={busy}>{busy ? t.submitting : t.submit}</button>
    </form>}<RecoverRewardLink /><CurrentOffers />
  </main><Footer /></>;
}
