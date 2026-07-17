type TesseractResult = { data: { text: string } };

declare global {
  interface Window {
    Tesseract?: { recognize: (image: File | string, language: string, options?: Record<string, unknown>) => Promise<TesseractResult> };
  }
}

let loading: Promise<void> | null = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('OCR 识别服务加载失败，请检查网络后重试。'));
    document.head.appendChild(script);
  });
  return loading;
}

async function imageElement(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  } finally {
    // The image has decoded before this URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function enhancedCrop(image: HTMLImageElement, crop: { x: number; y: number; width: number; height: number }, threshold = false) {
  const sourceX = Math.round(image.naturalWidth * crop.x);
  const sourceY = Math.round(image.naturalHeight * crop.y);
  const sourceWidth = Math.round(image.naturalWidth * crop.width);
  const sourceHeight = Math.round(image.naturalHeight * crop.height);
  const scale = Math.min(3, Math.max(1, 1800 / Math.max(sourceWidth, sourceHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
    const value = threshold ? (gray > 142 ? 255 : 0) : Math.max(0, Math.min(255, (gray - 110) * 1.75 + 128));
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function recognizeVariants(file: File, mode: 'plate' | 'vin') {
  await loadTesseract();
  if (!window.Tesseract) throw new Error('OCR 识别服务没有正确加载。');
  const image = await imageElement(file);
  const crops = mode === 'plate'
    ? [
        { x: 0, y: 0.35, width: 1, height: 0.65, threshold: false },
        { x: 0.18, y: 0.2, width: 0.82, height: 0.8, threshold: true },
        { x: 0, y: 0, width: 1, height: 1, threshold: false },
      ]
    : [
        { x: 0.1, y: 0.1, width: 0.8, height: 0.8, threshold: false },
        { x: 0, y: 0, width: 1, height: 1, threshold: true },
        { x: 0, y: 0, width: 1, height: 1, threshold: false },
      ];
  const texts: string[] = [];
  for (const crop of crops) {
    const source = enhancedCrop(image, crop, crop.threshold);
    const result = await window.Tesseract.recognize(source, 'eng', {
      tessedit_char_whitelist: mode === 'vin' ? 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      preserve_interword_spaces: '1',
    });
    texts.push(result.data.text.toUpperCase());
    if (mode === 'vin' && bestVin(texts)) break;
    if (mode === 'plate' && bestPlate(texts)?.score && bestPlate(texts)!.score >= 11) break;
  }
  return texts;
}

const vinValues: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const vinWeights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function validVinChecksum(vin: string) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  const sum = [...vin].reduce((total, character, index) => total + (Number.isNaN(Number(character)) ? vinValues[character] || 0 : Number(character)) * vinWeights[index], 0);
  const expected = sum % 11 === 10 ? 'X' : String(sum % 11);
  return vin[8] === expected;
}

function vinCandidates(texts: string[]) {
  const candidates = new Set<string>();
  for (const text of texts) {
    const groups = text.split(/\s+/).map(value => value.replace(/[^A-Z0-9]/g, '')).filter(Boolean);
    groups.push(text.replace(/[^A-Z0-9]/g, ''));
    for (const group of groups) {
      for (let start = 0; start <= group.length - 17; start += 1) {
        const raw = group.slice(start, start + 17);
        const normalized = raw.replace(/[OQ]/g, '0').replace(/I/g, '1');
        if (/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) candidates.add(normalized);
      }
    }
  }
  return [...candidates];
}

function bestVin(texts: string[]) {
  const candidates = vinCandidates(texts);
  return candidates.find(validVinChecksum) || candidates[0] || '';
}

function bestPlate(texts: string[]) {
  const ignored = new Set(['CALIFORNIA', 'VEHICLE', 'MOTORS', 'LICENSE', 'PLATE', 'DMVCA', 'UNKNOWN', 'UNREADABLE']);
  const candidates = new Set<string>();
  for (const text of texts) {
    for (const raw of text.split(/\s+/)) {
      const value = raw.replace(/[^A-Z0-9]/g, '');
      if (value.length >= 4 && value.length <= 8 && !ignored.has(value)) candidates.add(value);
    }
  }
  const ranked = [...candidates].map(value => {
    let score = 0;
    if (value.length === 7) score += 5;
    else if (value.length === 6 || value.length === 8) score += 3;
    if (/\d/.test(value)) score += 2;
    if (/[A-Z]/.test(value)) score += 2;
    if (/^[0-9][A-Z]{3}[0-9]{3}$/.test(value)) score += 5;
    if (/^[0-9]{4,6}[A-Z][0-9]$/.test(value)) score += 4;
    if (/(.)\1\1/.test(value)) score -= 2;
    return { value, score };
  }).sort((left, right) => right.score - left.score);
  return ranked[0];
}

async function readVinBarcode(file: File) {
  const Detector = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: ImageBitmap) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
  if (!Detector || !('createImageBitmap' in window)) return '';
  try {
    const bitmap = await createImageBitmap(file);
    const detected = await new Detector({ formats: ['qr_code', 'data_matrix'] }).detect(bitmap);
    bitmap.close();
    for (const item of detected) {
      const match = item.rawValue.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/);
      if (match) return match[0];
    }
  } catch { /* OCR remains available when barcode detection is unsupported. */ }
  return '';
}

type AiInvoker = <T = unknown>(name: string, body: Record<string, unknown>) => Promise<T>;

async function aiImage(file: File) {
  const image = await imageElement(file);
  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

async function recognizeWithAi(file: File, mode: 'plate' | 'vin', invoke: AiInvoker) {
  const prompt = mode === 'vin'
    ? 'Read the vehicle VIN from this photo. Focus on the line labeled VIN on the door-jamb/manufacturer label or dashboard. Return ONLY the exact 17-character VIN using uppercase A-Z and 0-9. VINs never contain I, O, or Q. Use the VIN check digit to verify the reading. If it cannot be read confidently, return UNKNOWN.'
    : 'Read the vehicle license plate number from this photo. Focus only on the large registration characters inside the physical license plate; ignore California, dealer markings, vehicle numbers, TCP/DOT numbers, frames, and background text. Return ONLY the plate number in uppercase letters and digits with no spaces or punctuation. If it cannot be read confidently, return UNKNOWN.';
  const response = await invoke<{ answer?: string }>('zg-ai', { type: 'photo', image: await aiImage(file), prompt });
  const answer = String(response.answer || '').toUpperCase().trim();
  if (mode === 'vin') {
    const vin = vinCandidates([answer]).find(validVinChecksum) || '';
    return vin;
  }
  const direct = answer.replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z0-9]{4,8}$/.test(direct) && !['UNKNOWN', 'UNREADABLE'].includes(direct)) return direct;
  return bestPlate([answer])?.value || '';
}

export async function recognizeVehiclePhoto(file: File, mode: 'plate' | 'vin', invoke?: AiInvoker) {
  if (invoke) {
    try {
      const recognized = await recognizeWithAi(file, mode, invoke);
      if (recognized) return recognized;
    } catch { /* Automatically fall back to on-device OCR. */ }
  }
  return mode === 'vin' ? recognizeVinPhoto(file) : recognizePlatePhoto(file);
}

export async function recognizeVinPhoto(file: File) {
  const barcodeVin = await readVinBarcode(file);
  if (barcodeVin) return barcodeVin;
  const vin = bestVin(await recognizeVariants(file, 'vin'));
  if (vin) return vin;
  throw new Error('没有识别到完整的 17 位 VIN。请让 VIN 字符占满画面、打开闪光灯并尽量正对标签后重试。');
}

export async function recognizePlatePhoto(file: File) {
  const best = bestPlate(await recognizeVariants(file, 'plate'));
  if (best) return best.value;
  throw new Error('没有清晰识别到车牌号码。请让车牌占画面三分之一以上、尽量正对车牌并避开反光。');
}
