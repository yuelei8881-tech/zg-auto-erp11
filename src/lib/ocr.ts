type TesseractResult = { data: { text: string } };

declare global {
  interface Window {
    Tesseract?: { recognize: (image: File | string, language: string) => Promise<TesseractResult> };
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

export async function recognizeVinPhoto(file: File) {
  await loadTesseract();
  if (!window.Tesseract) throw new Error('OCR 识别服务没有正确加载。');
  const result = await window.Tesseract.recognize(file, 'eng');
  const text = result.data.text.toUpperCase();
  const direct = text.match(/[A-HJ-NPR-Z0-9]{17}/g)?.[0];
  if (direct) return direct;
  const lines = text.split(/\r?\n/).map(line => line.replace(/[^A-HJ-NPR-Z0-9]/g, ''));
  const lineMatch = lines.find(line => line.length === 17);
  if (lineMatch) return lineMatch;
  throw new Error('没有识别到完整的 17 位 VIN。请将车架号拍清楚、尽量占满画面后重试。');
}

export async function recognizePlatePhoto(file: File) {
  await loadTesseract();
  if (!window.Tesseract) throw new Error('OCR 识别服务没有正确加载。');
  const result = await window.Tesseract.recognize(file, 'eng');
  const lines = result.data.text.toUpperCase().split(/\r?\n/)
    .map(line => line.replace(/[^A-Z0-9]/g, ''))
    .filter(line => line.length >= 4 && line.length <= 8);
  const candidates = [...new Set(lines)].filter(value => /[A-Z]/.test(value) && /\d/.test(value));
  const best = candidates.sort((a, b) => {
    const score = (value: string) => (value.length >= 6 && value.length <= 7 ? 3 : 0) + (/^[0-9][A-Z]{3}[0-9]{3}$/.test(value) ? 5 : 0);
    return score(b) - score(a);
  })[0];
  if (best) return best;
  throw new Error('没有清楚识别到车牌号码。请正对车牌拍摄、避开反光并让车牌占满画面。');
}
