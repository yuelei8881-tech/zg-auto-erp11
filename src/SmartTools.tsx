import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { CloudSession } from './lib/cloud';
import type { Vehicle, WorkOrder } from './types';
import { decodeVin, money } from './lib/erp';
import { recognizeVehiclePhoto } from './lib/ocr';

declare global {
  interface Window {
    Tesseract?: { recognize: (image: File | string, language: string, options?: Record<string, unknown>) => Promise<{ data: { text: string } }> };
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    SpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
type SpeechRecognitionLike = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void; onerror: () => void; onend: () => void };

type Props = { cloud: CloudSession; workOrders: WorkOrder[]; onVehicleDecoded?: (data: Partial<Vehicle>) => void };

export function SmartTools({ cloud, workOrders, onVehicleDecoded }: Props) {
  const [vin, setVin] = useState('');
  const [vinResult, setVinResult] = useState<Partial<Vehicle> | null>(null);
  const [busy, setBusy] = useState('');
  const [plate, setPlate] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [speech, setSpeech] = useState('');
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [photoResult, setPhotoResult] = useState('');
  const [selectedOrder, setSelectedOrder] = useState('');
  const [message, setMessage] = useState('您的车辆维修状态已更新。如有问题请联系 Z&G AUTO REPAIR。');
  const [serviceResult, setServiceResult] = useState('');

  const runVin = async () => {
    setBusy('vin');
    try { const result = await decodeVin(vin); setVinResult(result); onVehicleDecoded?.(result); }
    catch (error) { alert(error instanceof Error ? error.message : 'VIN 识别失败'); }
    finally { setBusy(''); }
  };

  const runOcr = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy('ocr'); setPlate(''); setOcrText('');
    try {
      const recognized = await recognizeVehiclePhoto(file, 'plate', cloud.invokeFunction);
      setPlate(recognized);
      setOcrText('已使用 AI 视觉识别，并通过本地 OCR 作为自动备用。');
    } catch (error) { alert(error instanceof Error ? error.message : '车牌识别失败'); }
    finally { setBusy(''); }
  };

  const toggleVoice = () => {
    if (listening) { recognition.current?.stop(); return; }
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) return alert('当前浏览器不支持语音输入，请使用新版 Edge 或 Chrome。');
    const instance = new Constructor();
    instance.lang = 'zh-CN'; instance.interimResults = false; instance.continuous = true;
    instance.onresult = event => {
      const text = Array.from(event.results).map(result => result[0].transcript).join('');
      setSpeech(current => `${current}${current ? ' ' : ''}${text}`);
    };
    instance.onerror = () => setListening(false);
    instance.onend = () => setListening(false);
    recognition.current = instance; setListening(true); instance.start();
  };

  const runAi = async () => {
    if (!aiQuestion.trim()) return;
    setBusy('ai'); setAiResult('');
    try {
      const response = await cloud.invokeFunction<{ answer?: string }>('zg-ai', { type: 'diagnosis', prompt: aiQuestion });
      setAiResult(response.answer || 'AI 没有返回内容。');
    } catch { setAiResult('AI 服务接口已经预留，但尚未配置 OPENAI_API_KEY 或部署 zg-ai 云函数。配置后此按钮即可直接使用。'); }
    finally { setBusy(''); }
  };

  const classifyPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy('photo'); setPhotoResult('');
    try {
      const base64 = await fileToDataUrl(file);
      const response = await cloud.invokeFunction<{ answer?: string }>('zg-ai', { type: 'photo', image: base64, prompt: '识别汽车照片的部位、损伤和建议分类。' });
      setPhotoResult(response.answer || '没有返回分类结果。');
    } catch { setPhotoResult('AI 照片分类接口已经预留；部署 zg-ai 云函数并配置 AI 密钥后即可启用。照片仍可先在接车检查中保存。'); }
    finally { setBusy(''); }
  };

  const sendSms = async () => {
    const order = workOrders.find(item => item.id === selectedOrder); if (!order) return alert('请先选择工单。');
    setBusy('sms'); setServiceResult('');
    try { await cloud.invokeFunction('zg-notify', { to: order.phone, message, workOrderId: order.id }); setServiceResult('短信已发送。'); }
    catch { setServiceResult('短信接口已预留，但尚未配置 Twilio 账号或部署 zg-notify 云函数。'); }
    finally { setBusy(''); }
  };

  const createPayment = async () => {
    const order = workOrders.find(item => item.id === selectedOrder); if (!order) return alert('请先选择工单。');
    setBusy('pay'); setServiceResult('');
    try {
      const response = await cloud.invokeFunction<{ url?: string }>('zg-payment', { workOrderId: order.id, description: `Invoice ${order.number}`, amount: Math.round(order.balance * 100) });
      if (response.url) window.open(response.url, '_blank'); else throw new Error('没有付款网址');
    } catch { setServiceResult('在线付款接口已预留，但尚未配置 Stripe 账号或部署 zg-payment 云函数。'); }
    finally { setBusy(''); }
  };

  return <div className="page smart-page"><div className="page-title"><div><p className="eyebrow">智能工具中心</p><h2>AI、VIN、OCR 与客户服务</h2></div><span className="version-chip">v0.83.1</span></div>
    <div className="smart-grid">
      <ToolCard title="VIN 自动识别" badge="立即可用"><div className="inline-form"><input value={vin} maxLength={17} onChange={e => setVin(e.target.value.toUpperCase())} placeholder="输入 17 位 VIN" /><button className="primary" onClick={runVin} disabled={busy === 'vin'}>{busy === 'vin' ? '识别中…' : '识别'}</button></div>{vinResult && <div className="result-box"><b>{vinResult.year} {vinResult.make} {vinResult.model}</b><span>{vinResult.engine}</span><span>{vinResult.vin}</span></div>}</ToolCard>
      <ToolCard title="OCR 车牌识别" badge="立即可用"><label className="upload-button">{busy === 'ocr' ? '正在识别…' : '拍照或选择车牌照片'}<input type="file" accept="image/*" capture="environment" onChange={runOcr} /></label>{plate && <div className="plate-result">{plate}</div>}{ocrText && <details><summary>查看 OCR 原文</summary><pre>{ocrText}</pre></details>}</ToolCard>
      <ToolCard title="语音生成维修记录" badge="立即可用"><button className={listening ? 'recording' : 'primary'} onClick={toggleVoice}>{listening ? '● 正在录音，点击停止' : '🎤 开始语音输入'}</button><textarea value={speech} onChange={e => setSpeech(e.target.value)} placeholder="语音内容会自动转成文字，也可以手动修改。" /><button onClick={() => navigator.clipboard.writeText(speech)}>复制维修记录</button></ToolCard>
      <ToolCard title="AI 故障诊断" badge="需配置 AI"><textarea value={aiQuestion} onChange={e => setAiQuestion(e.target.value)} placeholder="例如：2023 Escalade，故障码 P129F，冷车启动困难…" /><button className="primary" onClick={runAi} disabled={busy === 'ai'}>{busy === 'ai' ? '分析中…' : '开始 AI 分析'}</button>{aiResult && <div className="result-box pre-wrap">{aiResult}</div>}</ToolCard>
      <ToolCard title="AI 照片分类" badge="需配置 AI"><label className="upload-button">{busy === 'photo' ? '正在分析…' : '上传车辆或损伤照片'}<input type="file" accept="image/*" capture="environment" onChange={classifyPhoto} /></label>{photoResult && <div className="result-box pre-wrap">{photoResult}</div>}</ToolCard>
      <ToolCard title="短信与在线付款" badge="需配置服务"><select value={selectedOrder} onChange={e => setSelectedOrder(e.target.value)}><option value="">选择欠款工单</option>{workOrders.filter(item => item.balance > 0).map(item => <option key={item.id} value={item.id}>{item.number} · {item.customer} · {money(item.balance)}</option>)}</select><textarea value={message} onChange={e => setMessage(e.target.value)} /><div className="toolbar"><button onClick={sendSms} disabled={busy === 'sms'}>发送短信</button><button className="primary" onClick={createPayment} disabled={busy === 'pay'}>生成付款链接</button></div>{serviceResult && <div className="result-box">{serviceResult}</div>}</ToolCard>
    </div>
  </div>;
}

function ToolCard({ title, badge, children }: { title: string; badge: string; children: ReactNode }) {
  return <section className="tool-card"><div className="section-title"><h3>{title}</h3><span className="status-badge">{badge}</span></div>{children}</section>;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}
