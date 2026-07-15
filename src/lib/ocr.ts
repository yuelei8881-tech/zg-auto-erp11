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
