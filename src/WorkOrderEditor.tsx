import { useEffect, useMemo, useRef, useState } from 'react';
import type { Customer, Driver, EvidencePhoto, Fleet, InspectionChecklist, LaborItem, Part, PartItem, ShopSettings, Vehicle, WorkOrder, WorkOrderStatus } from './types';
import { decodeVin, money, recalculateWorkOrder, today, uid } from './lib/erp';
import { MONTHLY_BILLING_TERM, MONTHLY_PAYMENT_METHOD, nextMonthlyBillingDate } from './lib/billing';
import { recognizeVehiclePhoto } from './lib/ocr';
import { SignaturePad } from './SignaturePad';
import type { CloudSession, StaffMember } from './lib/cloud';

type Props = {
  value?: WorkOrder; customers: Customer[]; vehicles: Vehicle[]; fleets: Fleet[]; drivers: Driver[]; workOrders: WorkOrder[];
  parts: Part[]; settings: ShopSettings; nextNumber: string;
  onSave: (order: WorkOrder, keepOpen?: boolean) => Promise<void>; onCancel: () => void;
    onCreateVehicle: (vehicle: Vehicle) => Promise<void>;
    onPrint: (order: WorkOrder, documentType: string) => void;
    canPrintDocuments: boolean;
  cloud: CloudSession;
  currentUser: string;
  currentUserId: string; technicians: StaffMember[];
  canApproveReview: boolean; canAssignTechnician: boolean; canEditPricing: boolean; canViewFinancials: boolean;
};

type TranslationSource = 'complaint' | 'diagnosis' | 'workPerformed';
type TranslationTarget = 'complaintEn' | 'diagnosisEn' | 'workPerformedEn';
type TranslationStatus = 'idle' | 'translating' | 'done' | 'error';
type MobileStep = 'account' | 'inspection' | 'quote' | 'approval' | 'repair' | 'checkout';

const mobileSteps: Array<{ key: MobileStep; label: string; short: string }> = [
  { key: 'account', label: '接车与照片', short: '接车' },
  { key: 'inspection', label: '检查诊断', short: '检查' },
  { key: 'quote', label: '报价明细', short: '报价' },
  { key: 'approval', label: '客户批准', short: '批准' },
  { key: 'repair', label: '维修施工', short: '维修' },
  { key: 'checkout', label: '结账交车', short: '结账' },
];

const translationDefinitions: Array<{ source: TranslationSource; target: TranslationTarget; context: string }> = [
  { source: 'complaint', target: 'complaintEn', context: 'customer concern' },
  { source: 'diagnosis', target: 'diagnosisEn', context: 'inspection and diagnosis' },
  { source: 'workPerformed', target: 'workPerformedEn', context: 'completed repair work' },
];

const containsChinese = (value: string) => /[\u3400-\u9fff]/.test(value);
const editableNumber = (value: number | undefined) => value === 0 || value === undefined ? '' : value;

const statuses: WorkOrderStatus[] = ['等待检查', '等待批准', '等待配件', '维修中', '已完成', '已交车'];
const inspectionItems: Array<[keyof InspectionChecklist, string]> = [
  ['intake', '接车资料、里程和客户描述已确认'],
  ['exterior', '车辆外观、已有损伤和照片已记录'],
  ['scan', '维修前故障扫描或故障码已保存'],
  ['diagnosis', '检查与诊断结果已填写'],
  ['estimate', '人工、配件和报价明细已核对'],
];

const evidenceCategories: EvidencePhoto['category'][] = ['车牌', '正前', '正后', '左侧', '右侧', '左前', '右前', '左后', '右后', '仪表里程', '已有损伤', '故障扫描', '维修中', '维修完成', '其他'];
const requiredViews: EvidencePhoto['category'][] = ['正前', '正后', '左侧', '右侧'];
const workflowStages: NonNullable<WorkOrder['workflowStage']>[] = ['接车登记', '技师诊断', '报价待确认', '维修施工', '完工待结账', '已结账'];
const quickRepairItems: Array<{ name: string; hours: number }> = [
  { name: '更换发动机机油和滤芯', hours: 0.5 },
  { name: '检查刹车片和刹车盘', hours: 0.5 },
  { name: '更换前刹车片', hours: 1.5 },
  { name: '更换后刹车片', hours: 1.5 },
  { name: '轮胎换位', hours: 0.5 },
  { name: '轮胎平衡', hours: 1 },
  { name: '检查轮胎气压和磨损', hours: 0.3 },
  { name: '四轮定位', hours: 1 },
  { name: '检查并添加汽车油液', hours: 0.3 },
  { name: '更换发动机空气滤芯', hours: 0.3 },
  { name: '更换空调滤芯', hours: 0.5 },
  { name: '检查电瓶和充电系统', hours: 0.5 },
  { name: '更换火花塞', hours: 1.5 },
  { name: '更换变速箱油', hours: 1 },
  { name: '冷却系统检查', hours: 0.5 },
  { name: '更换冷却液', hours: 1 },
  { name: '空调系统检查', hours: 1 },
  { name: '故障码扫描和诊断', hours: 1 },
  { name: '全车安全检查', hours: 1 },
  { name: '路试和故障确认', hours: 0.5 },
];
const paymentMethods = ['未记录', '现金', '刷卡', '银行转账 / ACH', '支票', 'Zelle', '扫码支付', '在线付款', MONTHLY_PAYMENT_METHOD, '其他'];

async function compressEvidence(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = source;
  });
  const max = 1024;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  let quality = 0.68;
  let compressed = canvas.toDataURL('image/jpeg', quality);
  while (compressed.length > 600_000 && quality > 0.42) {
    quality -= 0.08;
    compressed = canvas.toDataURL('image/jpeg', quality);
  }
  return compressed;
}

type WorkOrderDraft = { key: string; savedAt: string; order: WorkOrder; mobileStep: MobileStep };
const draftDatabaseName = 'zg-auto-erp-drafts';
const draftStoreName = 'workOrders';
const openDraftDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(draftDatabaseName, 1);
  request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(draftStoreName)) request.result.createObjectStore(draftStoreName, { keyPath: 'key' }); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function readWorkOrderDraft(key: string) {
  const database = await openDraftDatabase();
  return new Promise<WorkOrderDraft | undefined>((resolve, reject) => {
    const request = database.transaction(draftStoreName, 'readonly').objectStore(draftStoreName).get(key);
    request.onsuccess = () => resolve(request.result as WorkOrderDraft | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}
async function writeWorkOrderDraft(draft: WorkOrderDraft) {
  const database = await openDraftDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database.transaction(draftStoreName, 'readwrite').objectStore(draftStoreName).put(draft);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}
async function removeWorkOrderDraft(key: string) {
  const database = await openDraftDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database.transaction(draftStoreName, 'readwrite').objectStore(draftStoreName).delete(key);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

export function WorkOrderEditor({ value, customers, vehicles, fleets, drivers, workOrders, parts, settings, nextNumber, onSave, onCancel, onCreateVehicle, onPrint, cloud, currentUser, currentUserId, technicians, canApproveReview, canAssignTechnician, canEditPricing, canViewFinancials, canPrintDocuments }: Props) {
  const [order, setOrder] = useState<WorkOrder>(() => recalculateWorkOrder(value || {
    id: uid(), number: nextNumber, date: today(), customer: '', vehicle: '', status: '等待检查',
    technician: canAssignTechnician ? '' : currentUser, technicianUserId: canAssignTechnician ? '' : currentUserId,
    laborItems: [], partItems: [], outsource: 0, discount: 0, taxRate: settings.defaultTaxRate,
  }));
  const [saving, setSaving] = useState(false);
  const [partSearch, setPartSearch] = useState('');
  const [activePanel, setActivePanel] = useState<'intake' | 'evidence' | 'pricing'>('intake');
  const [mobileStep, setMobileStep] = useState<MobileStep>('account');
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vinScanning, setVinScanning] = useState(false);
  const [plateScanning, setPlateScanning] = useState(false);
  const [evidenceCategory, setEvidenceCategory] = useState<EvidencePhoto['category']>('其他');
  const [evidenceSaving, setEvidenceSaving] = useState(false);
  const [vehicleDraft, setVehicleDraft] = useState({ plate: '', vin: '', year: String(new Date().getFullYear()), make: '', model: '', engine: '', mileage: 0 });
  const [translationStatus, setTranslationStatus] = useState<Record<TranslationSource, TranslationStatus>>({ complaint: 'idle', diagnosis: 'idle', workPerformed: 'idle' });
  const [translationError, setTranslationError] = useState<Record<TranslationSource, string>>({ complaint: '', diagnosis: '', workPerformed: '' });
  const lastAutomaticTranslation = useRef<Record<TranslationSource, { source: string; translation: string }>>({
    complaint: { source: '', translation: '' }, diagnosis: { source: '', translation: '' }, workPerformed: { source: '', translation: '' },
  });
  const translationRequestId = useRef<Record<TranslationSource, number>>({ complaint: 0, diagnosis: 0, workPerformed: 0 });
  const latestOrder = useRef(order);
  latestOrder.current = order;
  const draftKey = `work-order:${value?.id || 'new'}`;
  const calculated = useMemo(() => recalculateWorkOrder(order), [order]);
  const laborPriceHistory = useMemo(() => {
    const remembered = new Map<string, LaborItem>();
    [...workOrders]
      .filter(item => item.id !== value?.id)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .forEach(savedOrder => (savedOrder.laborItems || []).forEach(item => {
        const key = item.description.trim().toLocaleLowerCase();
        if (key && !remembered.has(key)) remembered.set(key, item);
      }));
    return remembered;
  }, [workOrders, value?.id]);
  const laborHistoryNames = useMemo(() => [...new Set([...laborPriceHistory.values()].map(item => item.description.trim()).filter(Boolean))], [laborPriceHistory]);
  const partLaborHistory = useMemo(() => {
    const remembered = new Map<string, LaborItem[]>();
    [...workOrders]
      .filter(item => item.id !== value?.id)
      .sort((a, b) => `${b.date || ''}-${b.number || ''}`.localeCompare(`${a.date || ''}-${a.number || ''}`))
      .forEach(savedOrder => {
        const laborItems = (savedOrder.laborItems || []).filter(item => item.description.trim());
        if (!laborItems.length) return;
        (savedOrder.partItems || []).forEach(partItem => {
          const keys = [partItem.partId && `id:${partItem.partId}`, partItem.partNo && `no:${partItem.partNo.trim().toLocaleLowerCase()}`].filter(Boolean) as string[];
          keys.forEach(key => { if (!remembered.has(key)) remembered.set(key, laborItems); });
        });
      });
    return remembered;
  }, [workOrders, value?.id]);
  const selectedVehicle = vehicles.find(v => v.id === order.vehicleId);
  const selectedAccountValue = order.fleetId ? `fleet:${order.fleetId}` : order.customerId ? `customer:${order.customerId}` : '';
  const availableVehicles = vehicles.filter(vehicle => !order.customerId && !order.fleetId || vehicle.ownerId === (order.fleetId || order.customerId));
  const checklist: InspectionChecklist = order.inspectionChecklist || { intake: false, exterior: false, scan: false, diagnosis: false, estimate: false };
  const inspectionDone = inspectionItems.filter(([key]) => checklist[key]).length;
  const reviewStatus = order.reviewStatus || (order.status === '等待批准' ? '待审查' : ['维修中', '已完成', '已交车'].includes(order.status) ? '已通过' : '未提交');
  const activeEvidence = (order.evidencePhotos || []).filter(item => !item.archivedAt);
  const workflowStage = order.workflowStage || '接车登记';
  const requiredViewCount = requiredViews.filter(category => activeEvidence.some(photo => photo.category === category)).length;
  const mobileStepComplete: Record<MobileStep, boolean> = {
    account: !!calculated.customer && !!calculated.vehicle,
    inspection: !!order.complaint?.trim() && !!order.diagnosis?.trim(),
    quote: calculated.laborItems.some(item => !!item.description.trim()) || calculated.partItems.some(item => !!item.name.trim()),
    approval: !!order.customerSignature || order.customerApprovalStatus === '客户已批准' || reviewStatus === '已通过',
    repair: requiredViewCount >= 4 && !!order.workPerformed?.trim(),
    checkout: calculated.balance <= 0.009 && !!order.paymentMethod,
  };

  useEffect(() => {
    let cancelled = false;
    void readWorkOrderDraft(draftKey).then(draft => {
      if (cancelled) return;
      if (draft && confirm(`发现 ${new Date(draft.savedAt).toLocaleString()} 自动保存的未完成工单，是否恢复？`)) {
        setOrder(recalculateWorkOrder(draft.order));
        setMobileStep(draft.mobileStep || 'account');
        setActivePanel(draft.mobileStep === 'account' || draft.mobileStep === 'inspection' ? 'intake' : draft.mobileStep === 'quote' || draft.mobileStep === 'checkout' ? 'pricing' : 'evidence');
      } else if (draft) void removeWorkOrderDraft(draftKey);
      setDraftReady(true);
    }).catch(() => { if (!cancelled) { setDraftStatus('error'); setDraftReady(true); } });
    return () => { cancelled = true; };
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady) return;
    setDraftStatus('saving');
    const timer = window.setTimeout(() => {
      void writeWorkOrderDraft({ key: draftKey, savedAt: new Date().toISOString(), order: calculated, mobileStep })
        .then(() => setDraftStatus('saved')).catch(() => setDraftStatus('error'));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [calculated, draftKey, draftReady, mobileStep]);

  const patch = (changes: Partial<WorkOrder>) => setOrder(current => recalculateWorkOrder({ ...current, ...changes }));

  const translateField = async (sourceField: TranslationSource, force = false) => {
    const definition = translationDefinitions.find(item => item.source === sourceField)!;
    const source = String(latestOrder.current[sourceField] || '').trim();
    const currentEnglish = String(latestOrder.current[definition.target] || '').trim();
    const previous = lastAutomaticTranslation.current[sourceField];
    if (!source || !containsChinese(source)) return;
    if (!force && currentEnglish && currentEnglish !== previous.translation) return;
    const requestId = ++translationRequestId.current[sourceField];
    setTranslationStatus(current => ({ ...current, [sourceField]: 'translating' }));
    setTranslationError(current => ({ ...current, [sourceField]: '' }));
    try {
      const result = await cloud.invokeFunction<{ answer?: string }>('zg-ai', {
        type: 'translation', prompt: source, context: definition.context,
      });
      const translation = String(result.answer || '').trim();
      if (!translation) throw new Error('No translation returned');
      if (translationRequestId.current[sourceField] !== requestId) return;
      const newestSource = String(latestOrder.current[sourceField] || '').trim();
      const newestEnglish = String(latestOrder.current[definition.target] || '').trim();
      if (newestSource !== source || (!force && newestEnglish && newestEnglish !== previous.translation)) return;
      lastAutomaticTranslation.current[sourceField] = { source, translation };
      patch({ [definition.target]: translation } as Partial<WorkOrder>);
      setTranslationStatus(current => ({ ...current, [sourceField]: 'done' }));
    } catch (error) {
      if (translationRequestId.current[sourceField] === requestId) {
        const rawMessage = error instanceof Error ? error.message : String(error || '翻译服务暂时不可用');
        const friendlyMessage = /Function failed to start|ByteString/i.test(rawMessage)
          ? '翻译服务器启动失败，请稍后点击“重新翻译”'
          : /invalid.*api.*key|incorrect api key|unauthorized/i.test(rawMessage)
            ? '翻译服务密钥无效，请联系系统管理员'
            : /quota|billing|credit/i.test(rawMessage)
              ? '翻译服务额度不足，请检查 AI 账户额度'
              : rawMessage.includes('OPENAI_API_KEY')
          ? '服务器尚未配置翻译密钥 OPENAI_API_KEY'
          : rawMessage.includes('non-2xx')
            ? '云端翻译服务返回错误，请检查服务器函数日志'
            : rawMessage;
        setTranslationError(current => ({ ...current, [sourceField]: friendlyMessage }));
        setTranslationStatus(current => ({ ...current, [sourceField]: 'error' }));
      }
    }
  };

  useEffect(() => {
    const timers = translationDefinitions.map(definition => {
      const source = String(order[definition.source] || '').trim();
      const english = String(order[definition.target] || '').trim();
      const previous = lastAutomaticTranslation.current[definition.source];
      if (!source || !containsChinese(source) || (english && english !== previous.translation) || source === previous.source) return undefined;
      return window.setTimeout(() => void translateField(definition.source), 1200);
    });
    return () => timers.forEach(timer => { if (timer !== undefined) window.clearTimeout(timer); });
  }, [order.complaint, order.diagnosis, order.workPerformed, order.complaintEn, order.diagnosisEn, order.workPerformedEn]);

  const translationControls = (field: TranslationSource) => {
    const status = translationStatus[field];
    return <span className={`translation-status ${status}`}>
      {status === 'translating' ? '正在自动翻译…' : status === 'done' ? '已自动翻译，可手动修改' : status === 'error' ? `自动翻译失败：${translationError[field] || '中文仍可正常保存'}` : '输入中文后自动翻译'}
      <button type="button" disabled={status === 'translating' || !containsChinese(String(order[field] || ''))} onClick={() => void translateField(field, true)}>重新翻译</button>
    </span>;
  };

  const dictate = (field: 'complaint' | 'diagnosis' | 'workPerformed') => {
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) return alert('当前浏览器不支持语音输入，请使用最新版 Chrome、Edge 或 Safari。');
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = (event: any) => {
      const text = String(event.results?.[0]?.[0]?.transcript || '').trim();
      if (text) patch({ [field]: `${order[field] ? `${order[field]}\n` : ''}${text}` });
    };
    recognition.onerror = () => alert('没有识别到语音，请允许麦克风权限后重试。');
    recognition.start();
  };

  const selectCustomer = (value: string) => {
    const [kind, id = ''] = value.split(':');
    const fleet = kind === 'fleet' ? fleets.find(item => item.id === id) : undefined;
    const customer = kind === 'customer' ? customers.find(item => item.id === id) : undefined;
    const monthlyBilling = customer?.billingTerms === MONTHLY_BILLING_TERM || fleet?.terms === MONTHLY_BILLING_TERM;
    patch({
      customerId: customer?.id || '', customer: customer?.name || fleet?.company || '', phone: customer?.phone || fleet?.phone || '',
      fleetId: fleet?.id || '', company: fleet?.company || '', driverId: '', driver: '', driverPhone: '',
      vehicleId: '', vehicle: '', plate: '', vin: '', mileage: 0,
      paymentMethod: monthlyBilling ? MONTHLY_PAYMENT_METHOD : '',
      billingDueDate: monthlyBilling ? nextMonthlyBillingDate() : undefined,
    });
  };

  const createVehicle = async () => {
    const customer = customers.find(item => item.id === order.customerId);
    const fleet = fleets.find(item => item.id === order.fleetId);
    if (!customer && !fleet) return alert('请先选择客户、公司或车队。');
    if (!vehicleDraft.plate.trim() || !vehicleDraft.year.trim() || !vehicleDraft.make.trim() || !vehicleDraft.model.trim()) return alert('请填写车牌、年份、品牌和车型。');
    const duplicate = vehicles.find(item => item.plate.trim().toUpperCase() === vehicleDraft.plate.trim().toUpperCase());
    if (duplicate) { selectVehicle(duplicate.id); setAddingVehicle(false); return alert('该车牌已存在，已经为您自动选中。'); }
    const vehicle: Vehicle = {
      id: uid(), ownerType: fleet ? '车队' : customer!.type, ownerId: fleet?.id || customer!.id, ownerName: fleet?.company || customer!.name,
      plate: vehicleDraft.plate.trim().toUpperCase(), vin: vehicleDraft.vin.trim().toUpperCase(),
      year: vehicleDraft.year.trim(), make: vehicleDraft.make.trim(), model: vehicleDraft.model.trim(), engine: vehicleDraft.engine.trim(), mileage: Number(vehicleDraft.mileage || 0),
    };
    setVehicleSaving(true);
    try {
      await onCreateVehicle(vehicle);
      patch({ vehicleId: vehicle.id, vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, plate: vehicle.plate, vin: vehicle.vin, mileage: vehicle.mileage });
      setAddingVehicle(false);
      setVehicleDraft({ plate: '', vin: '', year: String(new Date().getFullYear()), make: '', model: '', engine: '', mileage: 0 });
    } finally { setVehicleSaving(false); }
  };

  const selectVehicle = (id: string) => {
    const vehicle = vehicles.find(item => item.id === id);
    const fleet = fleets.find(item => item.id === vehicle?.ownerId);
    const driver = drivers.find(item => item.id === vehicle?.driverId);
    patch({
      vehicleId: id, vehicle: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim() : '',
      plate: vehicle?.plate || '', vin: vehicle?.vin || '', mileage: vehicle?.mileage || 0,
      fleetId: fleet?.id || '', company: fleet?.company || '', driverId: driver?.id || vehicle?.driverId || '',
      driver: driver?.name || vehicle?.driverName || '', driverPhone: driver?.phone || vehicle?.driverPhone || '',
    });
  };

  const scanVehicleVin = async (file?: File) => {
    if (!file) return;
    setVinScanning(true);
    try {
      const vin = await recognizeVehiclePhoto(file, 'vin', cloud.invokeFunction);
      const decoded = await decodeVin(vin);
      setVehicleDraft(current => ({ ...current, vin, year: decoded.year || current.year, make: decoded.make || current.make, model: decoded.model || current.model, engine: decoded.engine || current.engine }));
      alert(`已识别 VIN：${vin}\n车辆资料已自动填写，请核对后保存。`);
    } catch (error) { alert(`VIN 识别失败：${error instanceof Error ? error.message : error}`); }
    finally { setVinScanning(false); }
  };

  const scanVehiclePlate = async (file?: File) => {
    if (!file) return;
    setPlateScanning(true);
    try {
      const plate = await recognizeVehiclePhoto(file, 'plate', cloud.invokeFunction);
      setVehicleDraft(current => ({ ...current, plate }));
      alert(`已识别车牌：${plate}\n请核对后保存车辆。`);
    } catch (error) { alert(`车牌识别失败：${error instanceof Error ? error.message : error}`); }
    finally { setPlateScanning(false); }
  };

  const selectDriver = (id: string) => {
    const driver = drivers.find(item => item.id === id);
    patch({ driverId: id, driver: driver?.name || '', driverPhone: driver?.phone || '' });
  };

  const addLabor = () => patch({ laborItems: [...calculated.laborItems, {
    id: uid(), description: '', hours: 1, rate: settings.defaultLaborRate, technician: '', total: settings.defaultLaborRate, billingMode: 'hourly', flatAmount: 0,
  }] });
  const toggleQuickRepair = (template: { name: string; hours: number }) => {
    const existing = calculated.laborItems.find(item => item.description === template.name);
    if (existing) {
      patch({ laborItems: calculated.laborItems.filter(item => item.id !== existing.id) });
      return;
    }
    patch({ laborItems: [...calculated.laborItems, {
      id: uid(), description: template.name, hours: template.hours,
      rate: settings.defaultLaborRate, technician: order.technician || '',
      total: template.hours * settings.defaultLaborRate, billingMode: 'hourly', flatAmount: 0,
    }] });
  };
  const updateLabor = (id: string, changes: Partial<LaborItem>) => patch({
    laborItems: calculated.laborItems.map(item => item.id === id ? { ...item, ...changes } : item),
  });
  const applyRememberedLaborPrice = (id: string, description: string) => {
    const remembered = laborPriceHistory.get(description.trim().toLocaleLowerCase());
    if (!remembered) return;
    updateLabor(id, {
      description: remembered.description,
      billingMode: remembered.billingMode === 'flat' ? 'flat' : 'hourly',
      hours: Number(remembered.hours || 0),
      rate: Number(remembered.rate || 0),
      flatAmount: Number(remembered.flatAmount || 0),
    });
  };
  const removeLabor = (id: string) => patch({ laborItems: calculated.laborItems.filter(item => item.id !== id) });

  const addPart = () => patch({ partItems: [...calculated.partItems, {
    id: uid(), partId: '', partNo: '', name: '', qty: 1, cost: 0, price: 0, total: 0, costTotal: 0,
  }] });
  const inventoryMatches = useMemo(() => {
    const query = partSearch.trim().toLowerCase();
    if (!query) return [];
    return parts.filter(part => [part.partNo, part.oemNo, part.name, part.brand, part.supplier, part.location]
      .some(value => String(value || '').toLowerCase().includes(query))).slice(0, 12);
  }, [partSearch, parts]);
  const addInventoryPart = (part: Part) => {
    const nextParts = [...calculated.partItems, {
      id: uid(), partId: part.id, partNo: part.partNo, name: part.name, qty: 1,
      cost: part.cost || 0, price: part.price || 0, total: part.price || 0, costTotal: part.cost || 0,
    }];
    patch({ partItems: nextParts, laborItems: laborItemsForPart(part) });
    setPartSearch('');
  };
  const choosePart = (lineId: string, partId: string) => {
    const part = parts.find(item => item.id === partId);
    const nextParts = calculated.partItems.map(item => item.id === lineId ? { ...item, partId, partNo: part?.partNo || '', name: part?.name || '', cost: part?.cost || 0, price: part?.price || 0 } : item);
    patch({ partItems: nextParts, laborItems: part ? laborItemsForPart(part) : calculated.laborItems });
  };
  const laborItemsForPart = (part: Part) => {
    const remembered = partLaborHistory.get(`id:${part.id}`)
      || partLaborHistory.get(`no:${part.partNo.trim().toLocaleLowerCase()}`)
      || [];
    const existing = new Set(calculated.laborItems.map(item => item.description.trim().toLocaleLowerCase()).filter(Boolean));
    const additions = remembered
      .filter(item => !existing.has(item.description.trim().toLocaleLowerCase()))
      .map(item => ({
        ...item,
        id: uid(),
        technician: order.technician || item.technician || '',
        billingMode: item.billingMode === 'flat' ? 'flat' as const : 'hourly' as const,
        hours: Number(item.hours || 0), rate: Number(item.rate || 0), flatAmount: Number(item.flatAmount || 0),
      }));
    return [...calculated.laborItems, ...additions];
  };
  const updatePart = (id: string, changes: Partial<PartItem>) => patch({
    partItems: calculated.partItems.map(item => item.id === id ? { ...item, ...changes } : item),
  });
  const removePart = (id: string) => patch({ partItems: calculated.partItems.filter(item => item.id !== id) });

  const transitionReview = (action: '提交审查' | '批准维修' | '退回补充', changes: Partial<WorkOrder>) => {
    patch({ ...changes, reviewHistory: [...(order.reviewHistory || []), { id: uid(), action, by: currentUser, at: new Date().toISOString(), note: order.reviewNotes || '' }] });
  };
  const submitReview = () => {
    if (!checklist.intake || !checklist.exterior) return alert('请先完成接车资料和车辆外观两项检查。');
    if (requiredViewCount < 4) return alert('请完成车辆正前、正后、左侧、右侧四个方向的证据照片。');
    if (!order.diagnosis?.trim()) return alert('请先填写检查/诊断结果。');
    transitionReview('提交审查', { status: '等待批准', workflowStage: '报价待确认', reviewStatus: '待审查', submittedForReviewAt: new Date().toISOString() });
  };
  const approveReview = () => transitionReview('批准维修', { status: '维修中', workflowStage: '维修施工', reviewStatus: '已通过', reviewedBy: currentUser, reviewedAt: new Date().toISOString() });
  const returnReview = () => {
    if (!order.reviewNotes?.trim()) return alert('请填写退回补充的原因。');
    transitionReview('退回补充', { status: '等待检查', reviewStatus: '退回补充', reviewedBy: currentUser, reviewedAt: new Date().toISOString() });
  };

  const addEvidence = async (files: FileList | null, forcedCategory?: EvidencePhoto['category']) => {
    if (!files?.length) return;
    if ((order.evidencePhotos || []).length + files.length > 48) return alert('每张工单最多保留 48 张证据照片（含已作废归档照片）。');
    setEvidenceSaving(true);
    try {
      const additions: EvidencePhoto[] = [];
      const failedFiles: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const id = uid();
        try {
          const compressed = await compressEvidence(file);
          const blob = await (await fetch(compressed)).blob();
          const uploaded = await cloud.uploadEvidencePhoto(order.id, id, blob);
          additions.push({ id, category: forcedCategory || evidenceCategory, dataUrl: uploaded.dataUrl, storagePath: uploaded.storagePath, fileName: file.name, capturedAt: new Date().toISOString(), capturedBy: currentUser });
        } catch { failedFiles.push(file.name); }
      }
      if (failedFiles.length) alert(`${failedFiles.length} 张照片上传失败，未写入工单。请检查网络后重新选择：\n${failedFiles.join('\n')}`);
      if (!additions.length) return;
      const evidencePhotos = [...(order.evidencePhotos || []), ...additions];
      const category = forcedCategory || evidenceCategory;
      const exteriorCategories: EvidencePhoto['category'][] = [...requiredViews, '左前', '右前', '左后', '右后', '已有损伤'];
      patch({ evidencePhotos, inspectionChecklist: exteriorCategories.includes(category) ? { ...checklist, exterior: true } : checklist });
    } catch (error) { alert(`照片处理失败：${error instanceof Error ? error.message : error}`); }
    finally { setEvidenceSaving(false); }
  };

  const archiveEvidence = (photo: EvidencePhoto) => {
    const reason = prompt('照片不会被删除，只会标记作废并永久保留。请输入作废原因：', '重复照片');
    if (!reason?.trim()) return;
    patch({ evidencePhotos: (order.evidencePhotos || []).map(item => item.id === photo.id ? { ...item, archivedAt: new Date().toISOString(), archivedBy: currentUser, archiveReason: reason.trim() } : item) });
  };

  const submit = async () => {
    if (!calculated.customer || !calculated.vehicle) { setActivePanel('intake'); return alert('请选择客户和车辆。'); }
    if (!checklist.intake || !checklist.exterior) { setActivePanel('evidence'); return alert('请先完成“接车资料”和“车辆外观”两项检查。'); }
    if (calculated.laborItems.some(item => !item.description)) { setActivePanel('pricing'); return alert('请填写所有人工项目名称。'); }
    if (calculated.partItems.some(item => !item.name || item.qty <= 0)) { setActivePanel('pricing'); return alert('请检查配件名称和数量。'); }
    setSaving(true);
    try { await onSave(calculated); await removeWorkOrderDraft(draftKey); } finally { setSaving(false); }
  };
  const saveProgress = async () => {
    if (!calculated.customer || !calculated.vehicle) { selectMobileStep('account'); return alert('请先选择客户和车辆，然后即可保存当前进度。'); }
    setSaving(true);
    try {
      await onSave(recalculateWorkOrder({ ...calculated, inspectionChecklist: { ...checklist, intake: true } }), true);
    } finally { setSaving(false); }
  };

  const selectMobileStep = (step: MobileStep) => {
    setMobileStep(step);
    setActivePanel(step === 'account' || step === 'inspection' ? 'intake' : step === 'quote' || step === 'checkout' ? 'pricing' : 'evidence');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const mobileStepIndex = mobileSteps.findIndex(item => item.key === mobileStep);
  const moveMobileStep = (direction: -1 | 1) => {
    const next = mobileSteps[Math.max(0, Math.min(mobileSteps.length - 1, mobileStepIndex + direction))];
    if (next) selectMobileStep(next.key);
  };

  return <div className="editor-screen focused-editor" data-panel={activePanel} data-mobile-step={mobileStep}>
    <div className="editor-head"><div><p className="eyebrow">维修工单 / Repair Order</p><h2>{value ? `编辑 ${order.number}` : '新建维修工单'}</h2></div><div className="toolbar">{canPrintDocuments && <button type="button" onClick={() => onPrint(calculated, 'Repair Order')}>打印工单</button>}<button type="button" onClick={onCancel}>取消</button><button type="button" className="primary" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存工单'}</button></div></div>
    <div className="workflow-strip">{workflowStages.map((stage, index) => <div key={stage} className={`workflow-step ${workflowStages.indexOf(workflowStage) >= index ? 'done' : ''} ${workflowStage === stage ? 'active' : ''}`}><span className="step-number">{index + 1}</span><strong>{stage}</strong><small>{['前两项即可保存','员工领取并诊断','配件工时与确认','施工及证据留存','收款与交车','流程完成'][index]}</small></div>)}</div>

    <nav className="editor-section-nav" aria-label="工单填写步骤">
      <button type="button" className={activePanel === 'intake' ? 'active' : ''} onClick={() => setActivePanel('intake')}><span>1</span><b>接车资料</b><small>客户、车辆与描述</small></button>
      <button type="button" className={activePanel === 'evidence' ? 'active' : ''} onClick={() => setActivePanel('evidence')}><span>2</span><b>维修与证据</b><small>照片、签字与检查</small></button>
      <button type="button" className={activePanel === 'pricing' ? 'active' : ''} onClick={() => setActivePanel('pricing')}><span>3</span><b>费用结算</b><small>人工、配件与总价</small></button>
    </nav>

    <nav className="mobile-workflow-nav" aria-label="手机工单流程">
      {mobileSteps.map((step, index) => <button type="button" key={step.key} className={`${mobileStep === step.key ? 'active' : ''} ${mobileStepComplete[step.key] ? 'complete' : ''}`} onClick={() => selectMobileStep(step.key)}><span>{mobileStepComplete[step.key] ? '✓' : index + 1}</span><b>{step.short}</b></button>)}
    </nav>

    <section className="form-section editor-panel panel-intake"><h3>客户与车辆</h3><div className="form-grid four">
      <label>工单号<input value={order.number} onChange={e => patch({ number: e.target.value })} /></label>
      <label>日期<input type="date" value={order.date} onChange={e => patch({ date: e.target.value })} /></label>
      <label>状态<select value={order.status} disabled={!!order.archivedAt} onChange={e => patch({ status: e.target.value as WorkOrderStatus })}>{order.archivedAt && <option>已取消</option>}{statuses.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>负责技师{canAssignTechnician ? <select value={order.technicianUserId || ''} onChange={e => { const member = technicians.find(item => item.userId === e.target.value); patch({ technicianUserId: member?.userId || '', technician: member?.displayName || '' }); }}><option value="">未分配</option>{technicians.filter(item => item.role === 'technician' || item.role === 'manager').map(item => <option key={item.userId} value={item.userId}>{item.displayName || item.userId.slice(0, 8)}</option>)}</select> : <input value={order.technician || currentUser} readOnly />}</label>
      <label>客户 / 公司 / 车队<select value={selectedAccountValue} onChange={e => selectCustomer(e.target.value)}><option value="">请选择</option><optgroup label="个人与普通公司客户">{customers.map(item => <option key={item.id} value={`customer:${item.id}`}>{item.name} · {item.phone}</option>)}</optgroup><optgroup label="车队与公司账户">{fleets.map(item => <option key={item.id} value={`fleet:${item.id}`}>{item.company} · {item.contact} · {item.phone}</option>)}</optgroup></select></label>
      <label>联系电话<input value={order.phone || ''} onChange={e => patch({ phone: e.target.value })} /></label>
      <label>车辆<div className="input-action"><select value={order.vehicleId || ''} onChange={e => selectVehicle(e.target.value)}><option value="">{availableVehicles.length ? '选择当前账户车辆' : '暂无车辆，请快速添加'}</option>{availableVehicles.map(item => <option key={item.id} value={item.id}>{item.plate || item.vin} · {item.year} {item.make} {item.model}{item.ownerName ? ` · ${item.ownerName}` : ''}</option>)}</select><button type="button" onClick={() => setAddingVehicle(current => !current)}>＋ 添加</button></div></label>
      <label>当前里程<input type="number" value={order.mileage || ''} onChange={e => patch({ mileage: Number(e.target.value) })} /></label>
    </div>{addingVehicle && <div className="quick-vehicle">
      <div><b>快速添加当前客户车辆</b><span>可拍摄车牌或车架号自动识别；保存后会自动选中。</span></div>
      <div className="quick-vehicle-grid">
        <div className="vin-field"><span>车牌号码</span><input value={vehicleDraft.plate} onChange={e => setVehicleDraft(current => ({ ...current, plate: e.target.value.toUpperCase() }))} /><label className="vin-scan-button">{plateScanning ? '识别中…' : '📷 拍照识别车牌'}<input type="file" accept="image/*" capture="environment" disabled={plateScanning} onChange={e => { void scanVehiclePlate(e.target.files?.[0]); e.currentTarget.value = ''; }} /></label></div>
        <div className="vin-field"><span>VIN / 车架号</span><input value={vehicleDraft.vin} maxLength={17} onChange={e => setVehicleDraft(current => ({ ...current, vin: e.target.value.toUpperCase() }))} /><label className="vin-scan-button">{vinScanning ? '识别中…' : '📷 扫描 / 拍照识别'}<input type="file" accept="image/*" capture="environment" disabled={vinScanning} onChange={e => { void scanVehicleVin(e.target.files?.[0]); e.currentTarget.value = ''; }} /></label></div>
        <label>年份<input value={vehicleDraft.year} onChange={e => setVehicleDraft(current => ({ ...current, year: e.target.value }))} /></label>
        <label>品牌<input value={vehicleDraft.make} onChange={e => setVehicleDraft(current => ({ ...current, make: e.target.value }))} /></label>
        <label>车型<input value={vehicleDraft.model} onChange={e => setVehicleDraft(current => ({ ...current, model: e.target.value }))} /></label>
        <label>发动机<input value={vehicleDraft.engine} onChange={e => setVehicleDraft(current => ({ ...current, engine: e.target.value }))} /></label>
        <label>里程<input type="number" value={vehicleDraft.mileage || ''} onChange={e => setVehicleDraft(current => ({ ...current, mileage: Number(e.target.value) }))} /></label>
      </div><div className="toolbar"><button type="button" onClick={() => setAddingVehicle(false)}>取消</button><button type="button" className="primary" onClick={createVehicle} disabled={vehicleSaving}>{vehicleSaving ? '保存中…' : '保存并选择车辆'}</button></div>
    </div>}{selectedVehicle && <div className="vehicle-strip"><b>{selectedVehicle.plate || '无车牌'}</b><span>VIN {selectedVehicle.vin || '—'}</span><span>Unit {selectedVehicle.unit || '—'}</span><span>{selectedVehicle.ownerName}</span></div>}</section>

    {(order.company || selectedVehicle?.ownerType === '车队') && <section className="form-section editor-panel panel-intake"><h3>车队送修信息</h3><div className="form-grid four">
      <label>公司名称<input value={order.company || ''} onChange={e => patch({ company: e.target.value })} /></label>
      <label>司机资料<select value={order.driverId || ''} onChange={e => selectDriver(e.target.value)}><option value="">手动填写实际司机</option>{drivers.filter(item => item.fleetId === order.fleetId).map(item => <option key={item.id} value={item.id}>{item.name} · {item.phone}</option>)}</select></label>
      <label>本次实际司机<input value={order.driver || ''} onChange={e => patch({ driverId: '', driver: e.target.value })} placeholder="司机姓名" /></label>
      <label>司机联系电话<input type="tel" value={order.driverPhone || ''} onChange={e => patch({ driverPhone: e.target.value })} placeholder="手机号码" /></label>
      <label>PO Number<input value={order.po || ''} onChange={e => patch({ po: e.target.value })} /></label>
      <label className="span-2">维修授权人<input value={order.authorizedContact || ''} onChange={e => patch({ authorizedContact: e.target.value })} /></label>
    </div></section>}

    <section className="form-section editor-panel panel-intake"><h3>维修内容</h3><div className="form-grid three voice-fields">
      <label><span className="field-title">客户描述 <button type="button" onClick={() => dictate('complaint')}>🎤 语音</button></span><textarea value={order.complaint || ''} onChange={e => patch({ complaint: e.target.value })} /><small>English translation（打印显示）</small>{translationControls('complaint')}<textarea className="translation-input" value={order.complaintEn || ''} onChange={e => patch({ complaintEn: e.target.value })} placeholder="Customer concern in English" /></label>
      <label><span className="field-title">检查/诊断结果 <button type="button" onClick={() => dictate('diagnosis')}>🎤 语音</button></span><textarea value={order.diagnosis || ''} onChange={e => patch({ diagnosis: e.target.value })} /><small>English translation（打印显示）</small>{translationControls('diagnosis')}<textarea className="translation-input" value={order.diagnosisEn || ''} onChange={e => patch({ diagnosisEn: e.target.value })} placeholder="Diagnosis in English" /></label>
      <label><span className="field-title">完成的维修 <button type="button" onClick={() => dictate('workPerformed')}>🎤 语音</button></span><textarea value={order.workPerformed || ''} onChange={e => patch({ workPerformed: e.target.value })} /><small>English translation（打印显示）</small>{translationControls('workPerformed')}<textarea className="translation-input" value={order.workPerformedEn || ''} onChange={e => patch({ workPerformedEn: e.target.value })} placeholder="Work performed in English" /></label>
    </div><div className="form-grid two compact time-fields"><label>打印时间（可授权修改）<input type="datetime-local" value={order.printTime || ''} onChange={e => patch({ printTime: e.target.value })} /></label><label>做工时间备注<input value={order.workTimeNote || ''} onChange={e => patch({ workTimeNote: e.target.value })} placeholder="例如：2026/07/15 09:00–14:30" /></label></div></section>

    <section className="form-section evidence-section"><div className="section-title"><div><h3>证据留存 / Evidence</h3><span>正前、正后、左侧、右侧为 4 张必拍照片；可继续添加损伤、里程、维修过程等证据，每张工单最多 48 张。</span></div><b>{activeEvidence.length} / 48 张有效照片</b></div>
      <div className="direction-capture-grid">{requiredViews.map(category => { const photo = activeEvidence.find(item => item.category === category); return <label key={category} className={`direction-capture ${photo ? 'captured' : ''}`}><span className="car-outline">{category === '正前' ? '🚘' : category === '正后' ? '🚗' : '▱🚙▱'}</span><b>{category}</b><small>{photo ? '已拍摄，可重新补拍' : '必拍照片'}</small><input type="file" accept="image/*" capture="environment" disabled={evidenceSaving} onChange={e => { void addEvidence(e.target.files, category); e.currentTarget.value = ''; }} /></label>; })}</div>
      <div className="evidence-toolbar"><label>补充照片类别<select value={evidenceCategory} onChange={e => setEvidenceCategory(e.target.value as EvidencePhoto['category'])}>{evidenceCategories.map(item => <option key={item}>{item}</option>)}</select></label><label className="camera-button">{evidenceSaving ? '正在处理照片…' : '＋ 添加更多证据照片'}<input type="file" accept="image/*" capture="environment" multiple disabled={evidenceSaving} onChange={e => { void addEvidence(e.target.files); e.currentTarget.value = ''; }} /></label><span>第 4 张之后请在这里继续添加。系统会自动压缩，并记录拍摄人和时间。</span></div>
      <div className="evidence-grid">{activeEvidence.map(photo => <article key={photo.id} className="evidence-card"><button type="button" className="evidence-image" onClick={() => window.open(photo.dataUrl, '_blank')}><img src={photo.dataUrl} alt={photo.category} /></button><div><b>{photo.category}</b><small>{photo.capturedBy} · {new Date(photo.capturedAt).toLocaleString()}</small><input value={photo.note || ''} placeholder="照片备注（例如：右前保险杠原有划痕）" onChange={e => patch({ evidencePhotos: (order.evidencePhotos || []).map(item => item.id === photo.id ? { ...item, note: e.target.value } : item) })} /><label className="customer-photo-toggle"><input type="checkbox" checked={!!photo.customerVisible} onChange={e => patch({ evidencePhotos: (order.evidencePhotos || []).map(item => item.id === photo.id ? { ...item, customerVisible: e.target.checked } : item) })} />发送给客户时附带</label><button type="button" className="danger-link" onClick={() => archiveEvidence(photo)}>作废归档</button></div></article>)}</div>
      {!activeEvidence.length && <div className="empty-line">尚未留存证据照片。建议至少拍摄车牌、四角、仪表里程和已有损伤。</div>}
      {!!order.evidencePhotos?.some(item => item.archivedAt) && <details className="archived-evidence"><summary>查看已作废照片（{order.evidencePhotos.filter(item => item.archivedAt).length}）</summary>{order.evidencePhotos.filter(item => item.archivedAt).map(item => <div key={item.id}><span>{item.category} · {item.fileName}</span><small>{item.archivedBy} 作废于 {new Date(item.archivedAt!).toLocaleString()} · {item.archiveReason}</small></div>)}</details>}
    </section>

    <section className="form-section signature-section"><div className="section-title"><div><h3>客户手写签字 / Customer Signature</h3><span>客户可在手机、平板或电脑触摸屏直接签字；签名随工单同步并显示在打印工单中。</span></div>{order.customerSignedAt && <b>已签字</b>}</div>
      <label className="signature-name">签字人姓名<input value={order.customerSignedBy || ''} onChange={e => patch({ customerSignedBy: e.target.value })} placeholder={order.customer || '客户姓名'} /></label>
      <SignaturePad value={order.customerSignature} onChange={(customerSignature, customerSignedAt) => patch({ customerSignature, customerSignedAt, customerSignedBy: customerSignature ? (order.customerSignedBy || order.customer) : order.customerSignedBy })} />
      {order.customerSignedAt && <small className="signature-time">签署时间：{new Date(order.customerSignedAt).toLocaleString()}</small>}
    </section>

    <section className="form-section review-section"><div className="section-title"><div><h3>检查与审查流程</h3><span>Inspection & Review · 已完成 {inspectionDone}/{inspectionItems.length}</span></div><span className={`review-badge review-${reviewStatus}`}>{reviewStatus}</span></div>
      <div className="inspection-grid">{inspectionItems.map(([key, label]) => <label key={key}><input type="checkbox" checked={checklist[key]} onChange={e => patch({ inspectionChecklist: { ...checklist, [key]: e.target.checked } })} /><span>{label}</span></label>)}</div>
      <label className="review-notes">审查意见 / 退回原因<textarea value={order.reviewNotes || ''} onChange={e => patch({ reviewNotes: e.target.value })} placeholder="记录审查意见、需要补充的照片或检查项目" /></label>
      <div className="review-actions"><button type="button" onClick={submitReview} disabled={reviewStatus === '待审查'}>完成检查并提交审查</button>{reviewStatus === '待审查' && canApproveReview && <><button type="button" className="primary" onClick={approveReview}>批准并开始维修</button><button type="button" className="danger-soft" onClick={returnReview}>退回补充</button></>}{reviewStatus === '待审查' && !canApproveReview && <span className="muted">已提交，等待经理或老板审查</span>}</div>
      {(order.submittedForReviewAt || order.reviewedAt) && <div className="review-meta">{order.submittedForReviewAt && <span>提交：{new Date(order.submittedForReviewAt).toLocaleString()}</span>}{order.reviewedAt && <span>审查：{order.reviewedBy} · {new Date(order.reviewedAt).toLocaleString()}</span>}</div>}
      {!!order.reviewHistory?.length && <div className="review-history"><b>审查记录</b>{[...order.reviewHistory].reverse().map(item => <div key={item.id}><span>{item.action}</span><small>{item.by} · {new Date(item.at).toLocaleString()}{item.note ? ` · ${item.note}` : ''}</small></div>)}</div>}
    </section>

    <section className="form-section"><div className="section-title"><div><h3>人工项目</h3><span className="muted">左右滚动选择常用维修项目，再根据实际情况修改工时和费率。</span></div><button onClick={addLabor}>＋ 自定义工时</button></div>
      <div className="quick-repair-scroll" aria-label="常用维修项目">{quickRepairItems.map(template => { const selected = calculated.laborItems.some(item => item.description === template.name); return <button key={template.name} type="button" className={selected ? 'selected' : ''} onClick={() => toggleQuickRepair(template)}><b>{selected ? '✓ ' : '＋ '}{template.name}</b><small>默认 {template.hours} 工时</small></button>; })}</div>
      <div className="line-table"><div className="line-head labor-grid"><span>项目</span><span>计费</span><span>工时 / 一口价</span><span>费率</span><span>技师</span><span>小计</span><span /></div>
      <datalist id="labor-price-history">{laborHistoryNames.map(name => <option key={name} value={name} />)}</datalist>
      {calculated.laborItems.map(item => { const flat = item.billingMode === 'flat'; return <div className="line-row labor-grid" key={item.id}><input list="labor-price-history" value={item.description} onChange={e => updateLabor(item.id, { description: e.target.value })} onBlur={e => applyRememberedLaborPrice(item.id, e.target.value)} placeholder="例如：更换水泵（同名项目自动带入上次价格）" /><select value={flat ? 'flat' : 'hourly'} onChange={e => updateLabor(item.id, { billingMode: e.target.value as 'hourly' | 'flat', flatAmount: e.target.value === 'flat' ? item.total : item.flatAmount })}><option value="hourly">按小时</option><option value="flat">一口价</option></select><input type="number" inputMode="decimal" step={flat ? '0.01' : '0.1'} value={editableNumber(flat ? item.flatAmount : item.hours)} onChange={e => updateLabor(item.id, flat ? { flatAmount: Number(e.target.value) } : { hours: Number(e.target.value) })} aria-label={flat ? '一口价金额' : '工时'} /><input type="number" inputMode="decimal" step="0.01" value={editableNumber(item.rate)} disabled={flat} onChange={e => updateLabor(item.id, { rate: Number(e.target.value) })} /><input value={item.technician || ''} onChange={e => updateLabor(item.id, { technician: e.target.value })} /><b>{canViewFinancials ? money(item.total) : '—'}</b><button className="danger-link" onClick={() => removeLabor(item.id)}>删除</button></div> })}
      {!calculated.laborItems.length && <div className="empty-line">尚未添加人工项目</div>}</div>
    </section>

    <section className="form-section"><div className="section-title"><div><h3>配件项目</h3><span className="muted">选择库存配件时，自动带入该配件上次使用的人工项目和工时费。</span></div><button onClick={addPart}>＋ 手动配件</button></div>
      <div className="work-order-part-search"><input value={partSearch} onChange={event => setPartSearch(event.target.value)} placeholder="搜索仓库库存：配件编号、OEM、名称、品牌或供应商" />{partSearch && <button type="button" onClick={() => setPartSearch('')}>清除</button>}</div>
      {partSearch && <div className="inventory-search-results">{inventoryMatches.map(part => <button type="button" key={part.id} onClick={() => addInventoryPart(part)}><span><b>{part.partNo}</b><small>{part.name}{part.brand ? ` · ${part.brand}` : ''}</small></span><span><b>库存 {part.qty}</b><small>售价 {money(part.price)}</small></span></button>)}{!inventoryMatches.length && <p>没有找到匹配的库存配件，可以点击“手动配件”录入。</p>}</div>}
      <div className="line-table"><div className="line-head parts-grid"><span>库存配件</span><span>编号/名称</span><span>数量</span><span>售价</span><span>小计</span><span /></div>
      {calculated.partItems.map(item => <div className="line-row parts-grid" key={item.id}><select value={item.partId || ''} onChange={e => choosePart(item.id, e.target.value)}><option value="">手动项目</option>{parts.map(part => <option key={part.id} value={part.id}>{part.partNo} · {part.name}（库存 {part.qty}）</option>)}</select><div><input value={item.partNo} onChange={e => updatePart(item.id, { partNo: e.target.value })} placeholder="配件编号" /><input value={item.name} onChange={e => updatePart(item.id, { name: e.target.value })} placeholder="配件名称" /></div><input type="number" inputMode="numeric" step="1" value={editableNumber(item.qty)} onChange={e => updatePart(item.id, { qty: Number(e.target.value) })} /><input type="number" inputMode="decimal" step="0.01" value={editableNumber(item.price)} disabled={!canEditPricing} onChange={e => updatePart(item.id, { price: Number(e.target.value) })} /><b>{canViewFinancials ? money(item.total) : '—'}</b><button className="danger-link" onClick={() => removePart(item.id)}>删除</button></div>)}
      {!calculated.partItems.length && <div className="empty-line">尚未添加配件</div>}</div>
    </section>

    {canViewFinancials && <section className="form-section totals-section"><div><div className="form-grid four compact">
      <label>外包费用<input type="number" inputMode="decimal" step="0.01" value={editableNumber(order.outsource)} onChange={e => patch({ outsource: Number(e.target.value) })} /></label>
      <label>折扣<input type="number" inputMode="decimal" step="0.01" value={editableNumber(order.discount)} onChange={e => patch({ discount: Number(e.target.value) })} /></label>
      <label>配件销售税率 %（人工不计税）<input type="number" inputMode="decimal" step="0.01" value={editableNumber(order.taxRate)} onChange={e => patch({ taxRate: Number(e.target.value) })} /></label>
      <label>手动税额（留空自动计算）<input type="number" inputMode="decimal" min="0" step="0.01" placeholder={`自动 ${money(calculated.partsTotal * calculated.taxRate / 100)}`} value={order.taxOverride ?? ''} onChange={e => patch({ taxOverride: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} /></label>
      <label>累计已付款（请使用工单列表“收款”记录流水）<input type="number" inputMode="decimal" step="0.01" value={editableNumber(order.paid)} disabled title="为确保今日收入准确，请保存工单后使用工单列表中的收款按钮。" /></label>
      <label>客户支付方式<select value={order.paymentMethod === '月结' ? MONTHLY_PAYMENT_METHOD : (order.paymentMethod || '未记录')} onChange={e => { const paymentMethod = e.target.value === '未记录' ? '' : e.target.value; patch({ paymentMethod, billingDueDate: paymentMethod === MONTHLY_PAYMENT_METHOD ? (order.billingDueDate || nextMonthlyBillingDate()) : undefined }); }}>{paymentMethods.map(method => <option key={method}>{method}</option>)}</select></label>
      {(order.paymentMethod === MONTHLY_PAYMENT_METHOD || order.paymentMethod === '月结') && <label>月结结账日<input type="date" value={order.billingDueDate || nextMonthlyBillingDate()} onChange={e => patch({ billingDueDate: e.target.value })} /></label>}
      <label>实际结账金额（仅手动改价需双人授权）<input type="number" step="0.01" placeholder={`自动计算 ${money(calculated.laborTotal + calculated.partsTotal + calculated.outsource + calculated.tax - calculated.discount)}`} value={order.settlementTotal ?? ''} onChange={e => patch({ settlementTotal: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
    </div><p className="tax-guidance">加州默认规则：系统仅对配件销售额计算销售税；单独列示的维修/安装人工通常不计销售税。制造加工人工等例外请由会计确认。参考：<a href="https://www.cdtfa.ca.gov/formspubs/pub25.pdf" target="_blank" rel="noreferrer">CDTFA Publication 25</a>、<a href="https://www.cdtfa.ca.gov/lawguides/vol1/sutr/1546.html" target="_blank" rel="noreferrer">Regulation 1546</a>。</p></div><div className="totals-card"><div><span>人工（免销售税）</span><b>{money(calculated.laborTotal)}</b></div><div><span>配件</span><b>{money(calculated.partsTotal)}</b></div><div><span>配件销售税</span><b>{money(calculated.tax)}</b></div><div className="grand"><span>总价</span><b>{money(calculated.total)}</b></div><div className="balance"><span>欠款</span><b>{money(calculated.balance)}</b></div></div></section>}
    <div className="mobile-editor-actions"><div><small>{mobileStepIndex + 1} / {mobileSteps.length} · {draftStatus === 'saving' ? '正在自动保存…' : draftStatus === 'saved' ? '草稿已保存在本机' : draftStatus === 'error' ? '本机草稿保存失败' : '自动保存已开启'}</small><b>{mobileSteps[mobileStepIndex]?.label}</b></div><button type="button" onClick={() => moveMobileStep(-1)} disabled={mobileStepIndex === 0}>上一步</button><button type="button" className="primary" onClick={saveProgress} disabled={saving}>{saving ? '保存中…' : '保存进度'}</button><button type="button" onClick={() => moveMobileStep(1)} disabled={mobileStepIndex === mobileSteps.length - 1}>下一步</button></div>
  </div>;
}
